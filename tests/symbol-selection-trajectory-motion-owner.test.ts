import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  validateProject,
  symbolLayers,
  symbolArtworks,
  MAX_SYMBOL_ARTWORK,
  type Vector,
  type Project,
  type SymbolDefinition,
} from '../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
  sampleRememberedMotionFrames,
} from '../packages/animation/src/motion-spans';
import { type SampledUnitRequest } from '../packages/animation/src/selection-motion-owner';
import {
  captureSymbolRememberedSelectionAuthoringFrame,
  type SymbolSelectionAuthoringSource,
} from '../packages/animation/src/symbol-selection-motion-owner';
import { captureSymbolRememberedAuthoringFrame } from '../packages/animation/src/symbol-motion-owner';
import type { GroupAuthoringSource } from '../packages/animation/src/group-motion-owner';
import type { MotionPath } from '../packages/document/src/motion-path';
import type { TrajectoryRequest } from '../packages/animation/src/trajectory-input';
import * as selection from '../packages/animation/src/selection-motion-owner';
import * as document from '../packages/document/src';
import { matrix, worldPoint } from '../packages/geometry/src';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const cubic: MotionPath = { startX: 20, startY: 50, endX: -15, endY: 20 };
const waypoint: MotionPath = {
  startX: 0,
  startY: 0,
  endX: 0,
  endY: 0,
  waypoints: [
    { x: 30, y: 45 },
    { x: 55, y: -15 },
  ],
};
const curved: MotionPath = {
  ...waypoint,
  curvedWaypoints: true,
  waypointTangents: [
    { x: 10, y: 10 },
    { x: 15, y: 0 },
    { x: 15, y: 0 },
    { x: 10, y: 5 },
  ],
  waypointIncoming: [
    { x: -10, y: 3 },
    { x: -10, y: -3 },
  ],
};
function ink(id: string, x: number, groups?: string[]): Vector {
  return {
    id,
    kind: 'rectangle',
    x,
    y: 10,
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
  const layer = project.layers[0];
  layer.id = 'base';
  layer.drawingMode = 'object';
  const shapes = [
    ink('r', 0),
    ink('b', 20, ['outer', 'inner']),
    ink('a', 40, ['outer', 'inner']),
    ink('c', 60, ['outer']),
    ink('other', 100),
    ink('d', 130, ['second']),
    ink('e', 150, ['second']),
  ];
  if (mode === 'affine' || mode === 'reflected')
    for (const shape of shapes) {
      shape.rotation = 25;
      shape.transform = [mode === 'reflected' ? -1.3 : 1.3, 0.2, 0.4, 0.8];
    }
  if (mode === 'compound')
    for (const shape of shapes) {
      shape.kind = 'polygon';
      shape.closed = true;
      shape.fillRule = 'evenodd';
      shape.contours = [
        [
          [0, 0],
          [12, 0],
          [12, 12],
          [0, 12],
        ],
        [
          [3, 3],
          [3, 9],
          [9, 9],
          [9, 3],
        ],
      ].map((ring) => ring.map(([x, y]) => ({ x, y, out: { x: x + 1, y } })));
    }
  if (['loop', 'once', 'single', 'movie'].includes(mode)) {
    project.symbols = [
      {
        id: 'child',
        name: 'Child',
        width: 12,
        height: 12,
        shapes: [ink('kid', 0)],
        timeline: {
          duration: 3,
          keys: [{ frame: 2, shapes: [{ ...ink('kid', 0), fill: '#0000ff' }] }],
        },
      },
    ];
    shapes[3] = {
      ...shapes[3],
      kind: 'symbol',
      symbolId: 'child',
      symbolPlayback: { mode: mode as 'loop' | 'once' | 'single' | 'movie', firstFrame: 1 },
    };
  }
  layer.keys = [
    { frame: 0, shapes },
    { frame: 8, shapes: shapes.map((shape) => ({ ...structuredClone(shape), x: shape.x + 80 })) },
    { frame: 12, shapes: [] },
  ];
  createBasicMotionSpan(project, ['base'], 0, 8, 'linear', { affine: true }, undefined, {
    direction: 'shortest',
    turns: 0,
    rigidGroups: true,
    axisGroupScale: true,
    axisGroupShear: true,
  });
  const extra = {
    ...structuredClone(layer),
    id: 'extra',
    name: 'Extra',
    keys: [
      { frame: 0, shapes: structuredClone(shapes) },
      {
        frame: 10,
        shapes: shapes.map((shape) => ({ ...structuredClone(shape), x: shape.x + 100 })),
      },
      { frame: 12, shapes: [] },
    ],
    motionSpans: undefined,
  };
  project.layers.push(extra);
  createBasicMotionSpan(project, ['extra'], 0, 10, 'linear', { affine: true }, undefined, {
    direction: 'shortest',
    turns: 0,
    rigidGroups: true,
    axisGroupScale: true,
    axisGroupShear: true,
  });
  validateProject(project);
  return { project, frame: 4, revision: 2 };
}
const pick = (layerId: string, shapeId: string) => ({ layerId, shapeId });
const all = (layers = ['@base', 'extra']): SampledUnitRequest[] =>
  layers.flatMap((layer) => ['e', 'other', 'c', 'r'].map((id) => pick(layer, id))).reverse();
const paths = (path: MotionPath = cubic, layers = ['@base', 'extra']): TrajectoryRequest[] =>
  layers.map((layerId) => ({ layerId, shapeId: 'r', path: structuredClone(path) }));
const withoutXY = (shape: Vector) => {
  const { x, y, ...rest } = shape;
  void x;
  void y;
  return rest;
};

function fixture(mode = 'plain'): SymbolSelectionAuthoringSource {
  const { project } = rootFixture(mode),
    [base, extra] = project.layers;
  base.id = '@base';
  delete extra.drawingMode;
  const definition: SymbolDefinition = {
    id: 'local',
    name: 'Local',
    width: 400,
    height: 240,
    multiFramePivot: { x: 7, y: 9 },
    buttonStates: { up: 0, over: 4, down: 8, hit: 12 },
    shapes: base.keys[0].shapes,
    timeline: {
      duration: 14,
      keys: base.keys.slice(1),
      motionSpans: base.motionSpans,
      layers: [extra],
    },
  };
  return {
    definition,
    symbols: [definition, ...(project.symbols ?? [])],
    assets: project.assets,
    frame: 4,
    revision: 2,
  };
}
function adapter(state: SymbolSelectionAuthoringSource): Project {
  const p = newProject();
  p.duration = state.definition.timeline!.duration;
  p.layers = structuredClone(symbolLayers(state.definition)).map((layer) => ({
    ...layer,
    drawingMode: layer.drawingMode ?? 'object',
  }));
  p.symbols = structuredClone(state.symbols);
  p.assets = structuredClone(state.assets);
  return p;
}
function saved(p: Project, state: SymbolSelectionAuthoringSource): SymbolDefinition {
  const out = structuredClone(state.definition),
    [base, ...other] = p.layers;
  out.shapes = base.keys[0].shapes;
  out.timeline!.keys = base.keys.slice(1);
  out.timeline!.motionSpans = base.motionSpans;
  if (out.timeline!.layers !== undefined)
    out.timeline!.layers = other.map((layer, i) => {
      const next = { ...layer },
        old = state.definition.timeline!.layers![i];
      if (old.drawingMode === undefined) {
        if (Object.hasOwn(old, 'drawingMode')) next.drawingMode = undefined;
        else delete next.drawingMode;
      }
      return next;
    });
  return out;
}
const layers = (state: SymbolSelectionAuthoringSource) => symbolLayers(state.definition);

for (const mode of ['plain', 'affine', 'reflected', 'compound', 'loop', 'once', 'single', 'movie'])
  for (const path of [cubic, waypoint, curved, { ...curved, distance: true }])
    it(
      'prepares detached unsplit routes with exact symbol settings ' +
        mode +
        ' ' +
        JSON.stringify(path),
      () => {
        const state = fixture(mode),
          before = structuredClone(state),
          cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
          out = cap.prepareTrajectories(all(), paths(path)),
          expected = adapter(state);
        for (const layer of expected.layers)
          refreshBasicMotionSpan(
            expected,
            [layer.id],
            0,
            layer.id === '@base' ? 8 : 10,
            undefined,
            path,
          );
        expect(out).toEqual(saved(expected, state));
        expect(state).toEqual(before);
        expect(out.multiFramePivot).toEqual(before.definition.multiFramePivot);
        expect(out.buttonStates).toEqual(before.definition.buttonStates);
        const actual = symbolLayers(out),
          original = layers(state);
        for (let i = 0; i < actual.length; i++) {
          const end = i === 0 ? 8 : 10;
          expect(actual[i].motionSpans).toHaveLength(1);
          expect(actual[i].motionSpans![0].id).toBe(original[i].motionSpans![0].id);
          expect(actual[i].keys.filter((key) => [0, end, 12].includes(key.frame))).toEqual(
            original[i].keys.filter((key) => [0, end, 12].includes(key.frame)),
          );
          const baseline = sampleRememberedMotionFrames(
              adapter(state),
              [actual[i].id],
              0,
              end,
              4,
            )[0].shapes,
            pose = actual[i].keys[4].shapes;
          for (let n = 0; n < pose.length; n++) {
            expect(withoutXY(pose[n])).toEqual(withoutXY(baseline[n]));
            expect(matrix(pose[n]).slice(0, 4)).toEqual(matrix(baseline[n]).slice(0, 4));
            const a = worldPoint(pose[n], { x: 7, y: 11 }),
              b = worldPoint(baseline[n], { x: 7, y: 11 });
            expect(a.x - b.x).toBeCloseTo(pose[0].x - baseline[0].x, 8);
            expect(a.y - b.y).toBeCloseTo(pose[0].y - baseline[0].y, 8);
          }
        }
      },
    );
it('has independent analytic leader origins and different per-track paths/ranges', () => {
  const state = fixture(),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareTrajectories(all(), [...paths(cubic, ['@base']), ...paths(curved, ['extra'])]);
  const t = 0.5,
    u = 1 - t,
    pose = out.timeline!.keys.find((key) => key.frame === 4)!.shapes;
  expect(pose[0].x).toBeCloseTo(3 * u * u * t * 20 + 3 * u * t * t * 65 + t * t * t * 80, 10);
  expect(pose[0].y).toBeCloseTo(10 + 3 * u * u * t * 50 + 3 * u * t * t * 20, 10);
  expect(out.timeline!.layers![0].motionSpans![0].path).toEqual(curved);
  expect(out.timeline!.motionSpans![0].path).toEqual(cubic);
  const one = cap.prepareTrajectories(all(['extra']), paths(curved, ['extra']));
  expect(one.shapes).toEqual(state.definition.shapes);
  expect(one.timeline!.keys).toEqual(state.definition.timeline!.keys);
  expect(one.timeline!.motionSpans).toEqual(state.definition.timeline!.motionSpans);
});
for (const width of [0, 0.25, 1, 10000000])
  it('preserves admitted zero/fractional/large symbol dimensions ' + width, () => {
    const state = fixture();
    state.definition.width = width;
    state.definition.height = width;
    const out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
      all(),
      paths(),
    );
    expect(out.width).toBe(width);
    expect(out.height).toBe(width);
  });
for (const representation of [
  'absent',
  'undefined',
  'empty',
  'mode-absent',
  'mode-undefined',
  'mode-object',
])
  it('retains exact optional track representation ' + representation, () => {
    const state = fixture();
    if (['absent', 'undefined', 'empty'].includes(representation)) {
      if (representation === 'absent') delete state.definition.timeline!.layers;
      if (representation === 'undefined') state.definition.timeline!.layers = undefined;
      if (representation === 'empty') state.definition.timeline!.layers = [];
    } else if (representation === 'mode-undefined')
      state.definition.timeline!.layers![0].drawingMode = undefined;
    else if (representation === 'mode-object')
      state.definition.timeline!.layers![0].drawingMode = 'object';
    const tracks = representation.startsWith('mode') ? ['@base', 'extra'] : ['@base'],
      out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
        all(tracks),
        paths(cubic, tracks),
      );
    expect(Object.hasOwn(out.timeline!, 'layers')).toBe(
      Object.hasOwn(state.definition.timeline!, 'layers'),
    );
    if (representation === 'undefined') expect(out.timeline!.layers).toBeUndefined();
    if (representation === 'empty') expect(out.timeline!.layers).toEqual([]);
    if (representation.startsWith('mode')) {
      expect(Object.hasOwn(out.timeline!.layers![0], 'drawingMode')).toBe(
        Object.hasOwn(state.definition.timeline!.layers![0], 'drawingMode'),
      );
      expect(out.timeline!.layers![0].drawingMode).toBe(
        state.definition.timeline!.layers![0].drawingMode,
      );
    }
  });
it('keeps public selection hints and prepared output detached from future ownership', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    owner = cap.resolveSelection(all());
  cap.scene[0].key.shapes.length = 0;
  cap.choices.length = 0;
  owner.tracks[0].shapeIds.length = 0;
  owner.units[0].shapeIds.length = 0;
  const first = cap.prepareTrajectories(all(), paths());
  first.shapes.length = 0;
  first.timeline!.layers = [];
  const next = cap.prepareTrajectories(all(), paths());
  expect(next.shapes).toHaveLength(7);
  expect(next.timeline!.layers).toHaveLength(1);
  expect(state).toEqual(before);
});
it('reopens a saved unsplit route and authors a later detached route', () => {
  const state = fixture(),
    first = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
      all(),
      paths(),
    );
  const definition = JSON.parse(JSON.stringify(first)) as SymbolDefinition,
    reopened = { ...state, definition, symbols: [definition], frame: 5, revision: 0 };
  const out = captureSymbolRememberedSelectionAuthoringFrame(() => reopened).prepareTrajectories(
    all(),
    paths(curved),
  );
  expect(out.timeline!.motionSpans).toHaveLength(1);
  expect(out.timeline!.motionSpans![0].path).toEqual(curved);
  expect(out.shapes).toEqual(state.definition.shapes);
});
for (const kind of ['root', 'group'])
  it('matches exact legacy isolated ' + kind + ' route preparation', () => {
    const state = fixture(),
      p = adapter(state);
    for (const layer of p.layers) {
      const end = layer.id === '@base' ? 8 : 10;
      layer.keys = layer.keys.filter((key) => [0, end, 12].includes(key.frame));
      for (const key of layer.keys)
        key.shapes = key.shapes.filter((shape) =>
          kind === 'root' ? shape.id === 'r' : shape.groups?.[0] === 'outer',
        );
      layer.motionSpans = [];
      createBasicMotionSpan(p, [layer.id], 0, end, 'linear', { affine: true });
    }
    state.definition = saved(p, state);
    state.symbols[0] = state.definition;
    const selection = p.layers.map((layer) => pick(layer.id, kind === 'root' ? 'r' : 'c')),
      input = paths().map((path) => ({ ...path, shapeId: kind === 'root' ? 'r' : 'b' }));
    const out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
        selection,
        input,
      ),
      legacy = captureSymbolRememberedAuthoringFrame(() => ({
        definition: state.definition,
        symbols: state.symbols,
        revision: state.revision,
        frame: state.frame,
      }));
    expect(out).toEqual(
      kind === 'root' ? legacy.prepareTrajectories(input) : legacy.prepareGroupTrajectories(input),
    );
  });
for (const request of [
  [],
  [pick('@base', 'r')],
  [pick('@base', 'c')],
  [...all().filter((request) => request.shapeId !== 'other')],
  [pick('missing', 'r')],
  [pick('@base', 'r'), pick('@base', 'r')],
])
  it('rejects missing/overlapping/incomplete selected coverage ' + JSON.stringify(request), () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareTrajectories(request, paths())).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareTrajectories(all(), paths())).toBeDefined();
  });
for (const input of [
  [],
  [paths()[0]],
  [...paths(), paths()[0]],
  [{ ...paths()[0], shapeId: 'c' }, paths()[1]],
  [{ ...paths()[0], layerId: 'missing' }, paths()[1]],
  [null],
  null,
])
  it('rejects missing/duplicate/nonleader trajectory requests ' + JSON.stringify(input), () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareTrajectories(all(), input as never)).toThrow();
    expect(state).toEqual(before);
  });
for (const path of [
  null,
  {},
  { ...cubic, startX: NaN },
  { ...cubic, endY: Infinity },
  { ...cubic, startX: '2' },
  { ...cubic, tangent: true },
  { ...cubic, distance: 1 },
  { ...cubic, extra: 1 },
  { ...waypoint, waypoints: [] },
  { ...waypoint, waypoints: [{ x: 1, y: NaN }] },
  { ...curved, waypointTangents: [{ x: 1, y: 1 }] },
])
  it('rejects raw malformed/nonfinite/unsupported paths ' + JSON.stringify(path), () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() =>
      cap.prepareTrajectories(all(), [{ ...paths()[0], path }, paths()[1]] as never),
    ).toThrow();
    expect(state).toEqual(before);
  });
for (const field of [
  'definition',
  'library',
  'assets',
  'revision',
  'frame',
  'actual-library',
  'actual-assets',
  'actual-artwork',
])
  it('rejects changed private source ownership ' + field, () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    if (field === 'definition') state.definition = structuredClone(state.definition);
    if (field === 'library') state.symbols = [...state.symbols];
    if (field === 'assets') state.assets = [...state.assets];
    if (field === 'revision') state.revision++;
    if (field === 'frame') state.frame++;
    if (field === 'actual-library')
      state.symbols.push({ id: 'unused', name: 'Unused', width: 1, height: 1, shapes: [] });
    if (field === 'actual-assets') state.assets.push({ id: 'new', path: 'assets/new.bin' });
    if (field === 'actual-artwork') state.definition.shapes[0].fill = '#0000ff';
    const after = structuredClone(state);
    expect(() => cap.prepareTrajectories(all(), paths())).toThrow();
    expect(state).toEqual(after);
  });
for (const method of ['scene', 'choices', 'resolve', 'prepare', 'assert', 'dispose'])
  it('rejects enclosing reentry through ' + method, () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      before = structuredClone(state);
    const validate = () => {
      if (method === 'scene') void cap.scene;
      if (method === 'choices') void cap.choices;
      if (method === 'resolve') cap.resolveSelection(all());
      if (method === 'prepare') cap.prepareTrajectories(all(), paths());
      if (method === 'assert') cap.assertCurrent();
      if (method === 'dispose') cap.dispose();
    };
    expect(() => cap.prepareTrajectories(all(), paths(), { validate })).toThrow();
    expect(state).toEqual(before);
  });
for (const validate of [
  null,
  1,
  () => Promise.resolve(),
  () => {
    throw Error('enclosing');
  },
])
  it('rejects invalid/async/failed enclosing callbacks', () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareTrajectories(all(), paths(), { validate } as never)).toThrow();
    expect(state).toEqual(before);
  });
for (const swallowed of [false, true])
  it('invalidates getter reentry even when swallowed ' + swallowed, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      input = paths();
    Object.defineProperty(input[0], 'path', {
      get() {
        try {
          void cap.choices;
        } catch (error) {
          if (!swallowed) throw error;
        }
        return cubic;
      },
    });
    expect(() => cap.prepareTrajectories(all(), input)).toThrow();
    expect(() => cap.assertCurrent()).toThrow(/invalidated/);
    expect(state).toEqual(before);
  });
it('snapshots raw identity/path/point/callback getters only once', () => {
  const state = fixture(),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    reads = { layer: 0, id: 0, path: 0, x: 0, y: 0, validate: 0 };
  const point = {
      get x() {
        reads.x++;
        return 30;
      },
      get y() {
        reads.y++;
        return 45;
      },
    },
    path = { ...waypoint, waypoints: [point] },
    request = {
      get layerId() {
        reads.layer++;
        return '@base';
      },
      get shapeId() {
        reads.id++;
        return 'r';
      },
      get path() {
        reads.path++;
        return path;
      },
    };
  const options = {
    get validate() {
      reads.validate++;
      return () => {
        path.startX = 999;
      };
    },
  };
  const out = cap.prepareTrajectories(all(['@base']), [request], options);
  expect(out.timeline!.motionSpans![0].path!.startX).toBe(0);
  expect(reads).toEqual({ layer: 1, id: 1, path: 1, x: 1, y: 1, validate: 1 });
});
for (const field of ['path', 'point', 'callback'])
  it('rejects actual source mutation during raw getter ' + field, () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      input = paths(),
      options = { validate: () => {} };
    const changed = () => {
      state.assets.push({ id: 'late', path: 'assets/late.bin' });
    };
    if (field === 'path')
      Object.defineProperty(input[0], 'path', {
        get() {
          changed();
          return cubic;
        },
      });
    if (field === 'point')
      input[0].path = {
        ...waypoint,
        waypoints: [
          {
            get x() {
              changed();
              return 30;
            },
            y: 45,
          },
        ],
      };
    if (field === 'callback')
      Object.defineProperty(options, 'validate', {
        get() {
          changed();
          return () => {};
        },
      });
    expect(() => cap.prepareTrajectories(all(), input, options)).toThrow();
    expect(state.assets.at(-1)!.id).toBe('late');
  });
it('rejects an unchanged original route and permits a fresh replacement', () => {
  const state = fixture(),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareTrajectories(all(), paths());
  state.definition = out;
  state.symbols[0] = out;
  state.revision++;
  const next = captureSymbolRememberedSelectionAuthoringFrame(() => state);
  expect(() => next.prepareTrajectories(all(), paths())).toThrow(/does not change/);
  expect(next.prepareTrajectories(all(), paths(curved))).toBeDefined();
});
for (const mutation of ['finite', 'numeric', 'budget', 'metadata-undefined', 'source'])
  it('rejects completed definition clone tampering ' + mutation, () => {
    const state = fixture();
    state.definition.timeline!.layers![0].drawingMode = undefined;
    const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      before = structuredClone(state),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', ((value: unknown) => {
      const out = clone(value);
      if (out && typeof out === 'object' && 'timeline' in out && 'id' in out) {
        const definition = out as SymbolDefinition;
        if (definition.id === 'local' && definition.timeline?.motionSpans?.[0].path) {
          hit = true;
          if (mutation === 'finite') definition.timeline.keys[3].shapes[0].x++;
          if (mutation === 'numeric') definition.timeline.keys[3].shapes[0].x = NaN;
          if (mutation === 'budget')
            definition.shapes = Array(MAX_SYMBOL_ARTWORK + 1).fill(ink('same', 0));
          if (mutation === 'metadata-undefined') delete definition.timeline.layers![0].drawingMode;
          if (mutation === 'source') state.assets.push({ id: 'late', path: 'assets/late.bin' });
        }
      }
      return out;
    }) as typeof structuredClone);
    expect(() => cap.prepareTrajectories(all(), paths())).toThrow();
    expect(hit).toBe(true);
    if (mutation === 'source') before.assets.push({ id: 'late', path: 'assets/late.bin' });
    expect(state).toEqual(before);
  });
for (const mutation of ['finite', 'numeric', 'metadata-undefined', 'source'])
  it('rejects late enclosing changes after complete definition cloning ' + mutation, () => {
    const state = fixture();
    state.definition.timeline!.layers![0].drawingMode = undefined;
    const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      clone = structuredClone,
      before = structuredClone(state);
    let output: SymbolDefinition | undefined,
      calls = 0,
      hit = false;
    vi.stubGlobal('structuredClone', ((value: unknown) => {
      const out = clone(value);
      if (
        out &&
        typeof out === 'object' &&
        'timeline' in out &&
        'id' in out &&
        (out as SymbolDefinition).id === 'local' &&
        (out as SymbolDefinition).timeline?.motionSpans?.[0].path
      )
        output = out as SymbolDefinition;
      return out;
    }) as typeof structuredClone);
    const validate = () => {
      if (output && ++calls === 2) {
        hit = true;
        if (mutation === 'finite') output.timeline!.keys[3].shapes[0].x++;
        if (mutation === 'numeric') output.timeline!.keys[3].shapes[0].x = NaN;
        if (mutation === 'metadata-undefined') delete output.timeline!.layers![0].drawingMode;
        if (mutation === 'source') state.assets.push({ id: 'late', path: 'assets/late.bin' });
      }
    };
    expect(() => cap.prepareTrajectories(all(), paths(), { validate })).toThrow();
    expect(hit).toBe(true);
    if (mutation === 'source') before.assets.push({ id: 'late', path: 'assets/late.bin' });
    expect(state).toEqual(before);
  });

for (const mutation of ['order', 'ancestry', 'missing', 'extra'])
  it('requires complete original coverage at later symbol keys ' + mutation, () => {
    const state = fixture(),
      p = adapter(state),
      layer = p.layers[1],
      key = layer.keys[2];
    if (mutation === 'order') [key.shapes[0], key.shapes[4]] = [key.shapes[4], key.shapes[0]];
    if (mutation === 'ancestry') key.shapes[1].groups = ['outer', 'other-inner'];
    if (mutation === 'missing') key.shapes.splice(4, 1);
    if (mutation === 'extra') key.shapes.push(ink('unselected', 200));
    layer.motionSpans![0].baseline = JSON.stringify(
      layer.keys.filter((key) => key.frame > 0 && key.frame < 10),
    );
    state.definition = saved(p, state);
    state.symbols[0] = state.definition;
    const before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareTrajectories(all(), paths())).toThrow(/complete/);
    expect(state).toEqual(before);
  });
for (const sourceAligned of [false, true])
  it('preserves aligned unequal compound endpoints/correspondence ' + sourceAligned, () => {
    const state = fixture('compound'),
      p = adapter(state);
    for (const layer of p.layers) {
      const end = layer.id === '@base' ? 8 : 10,
        first = layer.keys[0].shapes,
        last = layer.keys[end].shapes;
      for (let i = 0; i < first.length; i++) {
        first[i].contours = first[i].contours!.map((ring) => ring.map(({ x, y }) => ({ x, y })));
        first[i].contours![1] = [
          { x: 3, y: 3 },
          { x: 3, y: 8 },
          { x: 8, y: 3 },
        ];
        last[i].contours = structuredClone(first[i].contours!).reverse();
      }
      const span = layer.motionSpans![0];
      span.options = { affine: true, nodes: true };
      span.rotation = { direction: 'shortest', turns: 0 };
      span.correspondence = sourceAligned
        ? { source: { order: [1, 0], start: [1, 1], reverse: [true, true] } }
        : { order: [1, 0], start: [1, 1], reverse: [true, true] };
      refreshBasicMotionSpan(p, [layer.id], 0, end);
    }
    state.definition = saved(p, state);
    state.symbols[0] = state.definition;
    const before = structuredClone(state),
      out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
        all(),
        paths(curved),
      );
    for (let i = 0; i < 2; i++) {
      const old = layers(state)[i],
        next = symbolLayers(out)[i],
        end = i === 0 ? 8 : 10;
      expect(next.keys.filter((key) => [0, end, 12].includes(key.frame))).toEqual(
        old.keys.filter((key) => [0, end, 12].includes(key.frame)),
      );
      expect(next.motionSpans![0].correspondence).toEqual(old.motionSpans![0].correspondence);
    }
    expect(state).toEqual(before);
  });
for (const mode of ['unequal', 'rotation', 'tangent', 'savedGroupPivots', 'rigidPivot', 'overflow'])
  it('retains no-orbit/all-track numeric admission ' + mode, () => {
    const state = fixture(),
      p = adapter(state),
      layer = p.layers[1];
    if (mode === 'unequal') layer.keys[10].shapes[0].x++;
    if (mode === 'rotation') layer.keys[10].shapes[0].rotation = 15;
    if (mode === 'tangent') layer.motionSpans![0].path = { ...cubic, tangent: true };
    if (mode === 'savedGroupPivots') {
      for (const frame of [0, 10])
        for (const shape of layer.keys[frame].shapes)
          if (shape.groups?.length)
            shape.pivot = { x: 100 - shape.x + frame * 10, y: 100 - shape.y };
      layer.motionSpans![0].rotation = {
        ...layer.motionSpans![0].rotation!,
        savedGroupPivots: true,
      };
      refreshBasicMotionSpan(p, ['extra'], 0, 10);
    }
    if (mode === 'rigidPivot')
      layer.motionSpans![0].rotation = {
        ...layer.motionSpans![0].rotation!,
        rigidPivot: { x: 1, y: 2 },
      };
    state.definition = saved(p, state);
    state.symbols[0] = state.definition;
    const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      before = structuredClone(state),
      input = paths();
    if (mode === 'overflow')
      input[1].path = {
        ...waypoint,
        waypoints: [
          { x: Number.MAX_VALUE, y: 0 },
          { x: -Number.MAX_VALUE, y: 0 },
        ],
        distance: true,
      };
    expect(() => cap.prepareTrajectories(all(), input)).toThrow();
    expect(state).toEqual(before);
    if (mode === 'overflow')
      expect(cap.prepareTrajectories(all(['@base']), paths(cubic, ['@base']))).toBeDefined();
  });
for (const mutation of ['finite', 'numeric', 'metadata-undefined'])
  it('protects complete root output before isolated conversion ' + mutation, () => {
    const state = fixture();
    state.definition.timeline!.layers![0].folderId = undefined;
    let prepared: Project | undefined,
      hit = false;
    const original = selection.captureRememberedSelectionAuthoringFrame;
    vi.spyOn(selection, 'captureRememberedSelectionAuthoringFrame').mockImplementation(
      (...args) => {
        const cap = original(...args),
          prepare = cap.prepareTrajectories;
        cap.prepareTrajectories = (...input) => {
          prepared = prepare(...input);
          return prepared;
        };
        return cap;
      },
    );
    const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      before = structuredClone(state);
    const validate = () => {
      if (prepared && !hit) {
        hit = true;
        if (mutation === 'finite') prepared.layers[1].keys[12].shapes = [ink('forged', 1)];
        if (mutation === 'numeric') prepared.layers[1].keys[12].shapes = [ink('forged', NaN)];
        if (mutation === 'metadata-undefined') delete prepared.layers[1].folderId;
      }
    };
    expect(() => cap.prepareTrajectories(all(), paths(), { validate })).toThrow();
    expect(hit).toBe(true);
    expect(state).toEqual(before);
  });
it('validates real bitmap resources throughout original and replacement libraries', () => {
  const state = fixture();
  state.assets = [
    {
      id: 'bitmap',
      path: 'assets/bitmaps/actual.json',
      bitmap: { name: 'Actual', width: 12, height: 12 },
    },
  ];
  const p = adapter(state);
  for (const layer of p.layers) {
    for (const frame of [0, layer.id === '@base' ? 8 : 10])
      layer.keys[frame].shapes[0].bitmap = {
        assetId: 'bitmap',
        x: 0,
        y: 0,
        width: 12,
        height: 12,
        repeat: true,
      };
    refreshBasicMotionSpan(p, [layer.id], 0, layer.id === '@base' ? 8 : 10);
  }
  state.definition = saved(p, state);
  state.symbols[0] = state.definition;
  state.symbols.push({
    id: 'unused',
    name: 'Unused bitmap',
    width: 12,
    height: 12,
    shapes: [
      {
        ...ink('unused', 0),
        bitmap: { assetId: 'bitmap', x: 0, y: 0, width: 12, height: 12, repeat: true },
      },
    ],
  });
  const before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareTrajectories(all(), paths());
  expect(out.timeline!.keys[3].shapes[0].bitmap).toEqual(state.definition.shapes[0].bitmap);
  expect(state).toEqual(before);
  state.assets = [];
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow();
});
it('rejects unused library raw nonfinite data rather than fabricating usable resources', () => {
  const state = fixture();
  state.symbols.push({
    id: 'unused',
    name: 'Unused',
    width: 1,
    height: 1,
    shapes: [{ ...ink('unused', 0), x: NaN }],
  });
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(/nonfinite/);
});
it('rejects null-hidden NaN introduced by the last source read after replacement validation', () => {
  const state = fixture();
  (state.definition as SymbolDefinition & { nullable: unknown }).nullable = null;
  const clone = structuredClone,
    validate = document.validateProject;
  let output: SymbolDefinition | undefined,
    replacements = 0,
    armed = false,
    hit = false;
  const cap = captureSymbolRememberedSelectionAuthoringFrame(() => {
    if (armed && output && !hit) {
      hit = true;
      (output as SymbolDefinition & { nullable: unknown }).nullable = NaN;
    }
    return state;
  });
  vi.stubGlobal('structuredClone', ((value: unknown) => {
    const out = clone(value);
    if (
      out &&
      typeof out === 'object' &&
      'timeline' in out &&
      (out as SymbolDefinition).id === 'local' &&
      (out as SymbolDefinition).timeline?.motionSpans?.[0].path
    )
      output = out as SymbolDefinition;
    return out;
  }) as typeof structuredClone);
  vi.spyOn(document, 'validateProject').mockImplementation((project, ...args) => {
    const result = validate(project, ...args);
    if (output && (project as Project).symbols?.includes(output) && ++replacements === 2)
      armed = true;
    return result;
  });
  expect(() => cap.prepareTrajectories(all(), paths())).toThrow(/nonfinite/);
  expect(hit).toBe(true);
  expect((state.definition as SymbolDefinition & { nullable: unknown }).nullable).toBeNull();
});
it('admits the actual combined original/replacement library budget exactly', () => {
  const state = fixture(),
    used = symbolArtworks(state.definition).reduce((n, artwork) => n + artwork.length, 0),
    remaining = MAX_SYMBOL_ARTWORK - used;
  state.symbols.push({
    id: 'large',
    name: 'Large',
    width: 1,
    height: 1,
    shapes: Array.from({ length: remaining }, (_, i) => ({
      ...ink(String(i), 0),
      width: 1,
      height: 1,
    })),
  });
  const before = JSON.stringify(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareTrajectories(all(['@base']), paths(cubic, ['@base']));
  expect(symbolArtworks(out).reduce((n, artwork) => n + artwork.length, 0)).toBe(used);
  expect(JSON.stringify(state)).toBe(before);
  cap.dispose();
}, 120000);
it('rejects original aggregate overflow across target and unused library definitions', () => {
  const state = fixture();
  state.symbols.push({
    id: 'over',
    name: 'Over',
    width: 1,
    height: 1,
    shapes: Array(MAX_SYMBOL_ARTWORK).fill(ink('same', 0)),
  });
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(
    /symbol artwork budget/,
  );
});

for (const timing of ['before', 'late'])
  it('rejects own-undefined actual symbol source changes ' + timing, () => {
    const state = fixture();
    state.definition.timeline!.layers![0].drawingMode = undefined;
    let armed = false,
      hit = false;
    const cap = captureSymbolRememberedSelectionAuthoringFrame(() => {
      if (armed && !hit) {
        hit = true;
        delete state.definition.timeline!.layers![0].drawingMode;
      }
      return state;
    });
    if (timing === 'before') armed = true;
    else {
      const clone = structuredClone;
      vi.stubGlobal('structuredClone', ((value: unknown) => {
        const out = clone(value);
        if (
          out &&
          typeof out === 'object' &&
          'timeline' in out &&
          (out as SymbolDefinition).id === 'local' &&
          (out as SymbolDefinition).timeline?.motionSpans?.[0].path
        )
          armed = true;
        return out;
      }) as typeof structuredClone);
    }
    expect(() => cap.prepareTrajectories(all(), paths())).toThrow();
    expect(hit).toBe(true);
    expect(Object.hasOwn(state.definition.timeline!.layers![0], 'drawingMode')).toBe(false);
  });

it('rejects accessor replacement installed by the final source read before serialization', () => {
  const state = fixture();
  (state.definition as SymbolDefinition & { nullable: unknown }).nullable = null;
  const clone = structuredClone,
    validate = document.validateProject;
  let output: SymbolDefinition | undefined,
    replacements = 0,
    armed = false,
    hit = false;
  const getter = vi.fn(() => {
    state.assets.push({ id: 'too-late', path: 'assets/late.bin' });
    return null;
  });
  const cap = captureSymbolRememberedSelectionAuthoringFrame(() => {
    if (armed && output && !hit) {
      hit = true;
      Object.defineProperty(output, 'nullable', {
        configurable: true,
        enumerable: true,
        get: getter,
      });
    }
    return state;
  });
  vi.stubGlobal('structuredClone', ((value: unknown) => {
    const out = clone(value);
    if (
      out &&
      typeof out === 'object' &&
      'timeline' in out &&
      (out as SymbolDefinition).id === 'local' &&
      (out as SymbolDefinition).timeline?.motionSpans?.[0].path
    )
      output = out as SymbolDefinition;
    return out;
  }) as typeof structuredClone);
  vi.spyOn(document, 'validateProject').mockImplementation((project, ...args) => {
    const result = validate(project, ...args);
    if (output && (project as Project).symbols?.includes(output) && ++replacements === 2)
      armed = true;
    return result;
  });
  expect(() => cap.prepareTrajectories(all(), paths())).toThrow(/data fields/);
  expect(hit).toBe(true);
  expect(getter).not.toHaveBeenCalled();
  expect(state.assets).toEqual([]);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  expect(cap.prepareTrajectories(all(), paths())).toBeDefined();
});
