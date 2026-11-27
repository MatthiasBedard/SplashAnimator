import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  validateProject,
  MAX_SYMBOL_ARTWORK,
  type Vector,
  type Project,
} from '../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
  sampleRememberedMotionFrames,
} from '../packages/animation/src/motion-spans';
import {
  captureRememberedSelectionAuthoringFrame,
  type SampledUnitRequest,
} from '../packages/animation/src/selection-motion-owner';
import { captureRememberedTrajectoryAuthoringFrame } from '../packages/animation/src/trajectory-motion-owner';
import {
  captureRememberedGroupAuthoringFrame,
  type GroupAuthoringSource,
} from '../packages/animation/src/group-motion-owner';
import type { MotionPath } from '../packages/document/src/motion-path';
import type { TrajectoryRequest } from '../packages/animation/src/trajectory-input';
import * as spans from '../packages/animation/src/motion-spans';
import { worldPoint, matrix } from '../packages/geometry/src';

afterEach(() => vi.restoreAllMocks());
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
function fixture(mode = 'plain'): GroupAuthoringSource {
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
const all = (layers = ['base', 'extra']): SampledUnitRequest[] =>
  layers.flatMap((layer) => ['e', 'other', 'c', 'r'].map((id) => pick(layer, id))).reverse();
const paths = (path: MotionPath = cubic, layers = ['base', 'extra']): TrajectoryRequest[] =>
  layers.map((layerId) => ({ layerId, shapeId: 'r', path: structuredClone(path) }));
const withoutXY = (shape: Vector) => {
  const { x, y, ...rest } = shape;
  void x;
  void y;
  return rest;
};

for (const mode of ['plain', 'affine', 'reflected', 'compound', 'loop', 'once', 'single', 'movie'])
  for (const path of [cubic, waypoint, curved, { ...curved, distance: true }])
    it(
      'prepares complete mixed recipes without promotion ' + mode + ' ' + JSON.stringify(path),
      () => {
        const state = fixture(mode),
          before = structuredClone(state),
          cap = captureRememberedSelectionAuthoringFrame(() => state),
          requests = paths(path),
          owner = cap.resolveSelection(all());
        const candidate = cap.prepareTrajectories(all(), requests),
          expected = structuredClone(state.project);
        for (const track of owner.tracks)
          refreshBasicMotionSpan(
            expected,
            [track.layerId],
            track.start,
            track.end,
            undefined,
            path,
          );
        expect(candidate).toEqual(expected);
        expect(state).toEqual(before);
        expect(candidate.symbols).toEqual(state.project.symbols);
        for (const track of owner.tracks) {
          const old = state.project.layers.find((layer) => layer.id === track.layerId)!,
            next = candidate.layers.find((layer) => layer.id === track.layerId)!;
          expect(next.motionSpans).toHaveLength(1);
          expect(next.motionSpans![0].id).toBe(old.motionSpans![0].id);
          expect(next.keys.filter((key) => [0, track.end, 12].includes(key.frame))).toEqual(
            old.keys.filter((key) => [0, track.end, 12].includes(key.frame)),
          );
          const original = sampleRememberedMotionFrames(
            state.project,
            [track.layerId],
            track.start,
            track.end,
            4,
          )[0].shapes;
          const actual = next.keys.find((key) => key.frame === 4)!.shapes;
          for (let i = 0; i < actual.length; i++) {
            expect(withoutXY(actual[i])).toEqual(withoutXY(original[i]));
            expect(matrix(actual[i]).slice(0, 4)).toEqual(matrix(original[i]).slice(0, 4));
            const a = worldPoint(actual[i], { x: 7, y: 11 }),
              b = worldPoint(original[i], { x: 7, y: 11 });
            expect(a.x - b.x).toBeCloseTo(actual[0].x - original[0].x, 8);
            expect(a.y - b.y).toBeCloseTo(actual[0].y - original[0].y, 8);
          }
        }
        cap.dispose();
      },
    );
it('uses the original leader origin with an independent analytic cubic oracle', () => {
  const state = fixture(),
    candidate = captureRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
      all(),
      paths(),
    );
  for (const layer of candidate.layers) {
    const end = layer.id === 'base' ? 8 : 10,
      t = 4 / end,
      u = 1 - t;
    const x = 3 * u * u * t * 20 + 3 * u * t * t * (end * 10 - 15) + t * t * t * (end * 10),
      y = 10 + 3 * u * u * t * 50 + 3 * u * t * t * 20;
    const actual = layer.keys.find((key) => key.frame === 4)!.shapes;
    expect(actual[0].x).toBeCloseTo(x, 10);
    expect(actual[0].y).toBeCloseTo(y, 10);
    for (let i = 0; i < actual.length; i++)
      expect(actual[i].x - actual[0].x).toBeCloseTo(
        state.project.layers[0].keys[0].shapes[i].x,
        10,
      );
  }
});
it('accepts independent original-track paths/ranges and leaves unselected tracks exact', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state);
  const one = cap.prepareTrajectories(all(['base']), paths(curved, ['base']));
  expect(one.layers[1]).toEqual(state.project.layers[1]);
  const two = cap.prepareTrajectories(all(), [
    ...paths(curved, ['extra']),
    ...paths(cubic, ['base']),
  ]);
  expect(two.layers[0].motionSpans![0].path).toEqual(cubic);
  expect(two.layers[1].motionSpans![0].path).toEqual(curved);
});
it('public scenes/owners/choices and returned output never own later routes', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    owner = cap.resolveSelection(all());
  cap.scene[0].key.shapes.length = 0;
  cap.choices.length = 0;
  owner.tracks[0].shapeIds.length = 0;
  owner.units[0].shapeIds.length = 0;
  const first = cap.prepareTrajectories(all(), paths());
  first.layers[0].keys[4].shapes.length = 0;
  first.symbols = [];
  expect(cap.prepareTrajectories(all(), paths()).layers[0].keys[4].shapes).toHaveLength(7);
  expect(state).toEqual(before);
});
it('reopens the same unsplit recipe for a later route edit', () => {
  const state = fixture(),
    first = captureRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
      all(),
      paths(),
    );
  const reopened = { project: JSON.parse(JSON.stringify(first)) as Project, frame: 5, revision: 0 };
  const candidate = captureRememberedSelectionAuthoringFrame(() => reopened).prepareTrajectories(
    all(),
    paths(curved),
  );
  expect(candidate.layers[0].motionSpans).toHaveLength(1);
  expect(candidate.layers[0].motionSpans![0].start).toBe(0);
  expect(candidate.layers[0].motionSpans![0].end).toBe(8);
  expect(candidate.layers[0].keys[0]).toEqual(state.project.layers[0].keys[0]);
});
for (const kind of ['root', 'group'])
  it('retains exact legacy ' + kind + ' recipe preparation', () => {
    const state = fixture();
    for (const layer of state.project.layers) {
      for (const key of layer.keys)
        key.shapes = key.shapes.filter((shape) =>
          kind === 'root' ? shape.id === 'r' : shape.groups?.[0] === 'outer',
        );
      layer.keys = layer.keys.filter((key) =>
        [0, layer.id === 'base' ? 8 : 10, 12].includes(key.frame),
      );
      layer.motionSpans = [];
      createBasicMotionSpan(state.project, [layer.id], 0, layer.id === 'base' ? 8 : 10, 'linear', {
        affine: true,
      });
    }
    const requests = state.project.layers.map((layer) =>
        pick(layer.id, kind === 'root' ? 'r' : 'c'),
      ),
      trajectory = paths().map((request) => ({ ...request, shapeId: kind === 'root' ? 'r' : 'b' }));
    const actual = captureRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
      requests,
      trajectory,
    );
    const expected =
      kind === 'root'
        ? captureRememberedTrajectoryAuthoringFrame(() => state).prepareTrajectories(trajectory)
        : captureRememberedGroupAuthoringFrame(() => state).prepareGroupTrajectories(trajectory);
    expect(actual).toEqual(expected);
  });
for (const selected of [
  [pick('base', 'r')],
  [pick('base', 'c')],
  [pick('base', 'r'), pick('base', 'c')],
  [...all(['base']).filter((request) => request.shapeId !== 'other')],
])
  it('rejects incomplete original selected recipe ' + JSON.stringify(selected), () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      spy = vi.spyOn(spans, 'refreshBasicMotionSpan');
    expect(() => cap.prepareTrajectories(selected, paths(cubic, ['base']))).toThrow(
      /complete|canonical/,
    );
    expect(spy).not.toHaveBeenCalled();
    expect(state).toEqual(before);
    expect(cap.prepareTrajectories(all(), paths())).toBeDefined();
  });
for (const malformed of [
  [],
  [paths()[0]],
  [...paths(), paths()[0]],
  [{ layerId: 'bad', shapeId: 'r', path: cubic }, paths()[1]],
  [{ layerId: 'base', shapeId: 'c', path: cubic }, paths()[1]],
  [{ layerId: 'base', path: cubic }, paths()[1]],
  { 0: paths()[0], length: 1 },
  [null],
  null,
])
  it('rejects missing/duplicate/nonleader paths ' + JSON.stringify(malformed), () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareTrajectories(all(), malformed as never)).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareTrajectories(all(), paths())).toBeDefined();
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
      cap = captureRememberedSelectionAuthoringFrame(() => state);
    expect(() =>
      cap.prepareTrajectories(all(), [{ ...paths()[0], path }, paths()[1]] as never),
    ).toThrow();
    expect(state).toEqual(before);
  });
for (const mode of [
  'hidden',
  'locked',
  'merge',
  'frame',
  'library',
  'reference',
  'revision',
  'source-nan',
  'generated',
])
  it('rejects stale or non-authorable source ' + mode, () => {
    const state = fixture(),
      cap = captureRememberedSelectionAuthoringFrame(() => state);
    if (mode === 'hidden') state.project.layers[1].visible = false;
    if (mode === 'locked') state.project.layers[1].locked = true;
    if (mode === 'merge') state.project.layers[1].drawingMode = 'merge';
    if (mode === 'frame') state.frame++;
    if (mode === 'library') state.project.symbols = [];
    if (mode === 'reference') state.project = structuredClone(state.project);
    if (mode === 'revision') state.revision++;
    if (mode === 'source-nan') state.project.layers[1].keys[0].shapes[0].x = NaN;
    if (mode === 'generated') state.project.layers[1].keys[4].shapes[0].x++;
    const before = structuredClone(state);
    expect(() => cap.prepareTrajectories(all(), paths())).toThrow();
    expect(state).toEqual(before);
  });
for (const mode of ['unequal', 'rotation', 'tangent', 'savedGroupPivots', 'rigidPivot', 'overflow'])
  it('rejects later-track no-orbit/numeric admission ' + mode, () => {
    const state = fixture(),
      layer = state.project.layers[1];
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
      refreshBasicMotionSpan(state.project, ['extra'], 0, 10);
    }
    if (mode === 'rigidPivot')
      layer.motionSpans![0].rotation = {
        ...layer.motionSpans![0].rotation!,
        rigidPivot: { x: 1, y: 2 },
      };
    const cap = captureRememberedSelectionAuthoringFrame(() => state),
      before = structuredClone(state),
      input = paths();
    if (mode === 'overflow')
      input[1].path = { ...cubic, startX: Number.MAX_VALUE, endX: Number.MAX_VALUE };
    expect(() => cap.prepareTrajectories(all(), input)).toThrow();
    expect(state).toEqual(before);
  });
it('snapshots all raw controls/indices/callbacks once without following later mutations', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
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
  };
  const path = { ...waypoint, waypoints: [point] },
    request = {
      get layerId() {
        reads.layer++;
        return 'base';
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
  const out = cap.prepareTrajectories(all(['base']), [request], options);
  expect(out.layers[0].motionSpans![0].path!.startX).toBe(0);
  expect(reads).toEqual({ layer: 1, id: 1, path: 1, x: 1, y: 1, validate: 1 });
});
for (const field of ['selection', 'layer', 'id', 'path', 'point', 'callback', 'length'])
  it('rejects one-shot getters mutating source or array scope ' + field, () => {
    const state = fixture(),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      selection = all(),
      input = paths(),
      options = { validate: () => {} };
    const changed = () => {
      state.revision++;
    };
    if (field === 'selection')
      Object.defineProperty(selection[0], 'shapeId', {
        get() {
          changed();
          return 'r';
        },
      });
    if (field === 'layer' || field === 'id' || field === 'path')
      Object.defineProperty(
        input[0],
        field === 'layer' ? 'layerId' : field === 'id' ? 'shapeId' : 'path',
        {
          get() {
            changed();
            return field === 'layer' ? 'base' : field === 'id' ? 'r' : cubic;
          },
        },
      );
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
    if (field === 'length')
      Object.defineProperty(input, 0, {
        get() {
          input.push(paths()[0]);
          return paths()[0];
        },
      });
    const before = structuredClone(state.project);
    expect(() => cap.prepareTrajectories(selection, input, options)).toThrow();
    expect(state.project).toEqual(before);
  });
for (const method of ['scene', 'choices', 'resolve', 'prepare', 'assert', 'dispose'])
  it('rejects enclosing reentry through ' + method, () => {
    const state = fixture(),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
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
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      before = structuredClone(state);
    expect(() => cap.prepareTrajectories(all(), paths(), { validate } as never)).toThrow();
    expect(state).toEqual(before);
  });
it('pre-admits all tracks before detached refresh and keeps source atomic on later refresh failure', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    before = structuredClone(state),
    original = spans.refreshBasicMotionSpan;
  let calls = 0;
  vi.spyOn(spans, 'refreshBasicMotionSpan').mockImplementation((...args) => {
    calls++;
    if (calls === 2) throw Error('later track');
    return original(...args);
  });
  expect(() => cap.prepareTrajectories(all(), paths())).toThrow(/later track/);
  expect(calls).toBe(2);
  expect(state).toEqual(before);
});
it('rejects an unchanged original route without consuming valid capture state', () => {
  const state = fixture();
  for (const layer of state.project.layers)
    refreshBasicMotionSpan(
      state.project,
      [layer.id],
      0,
      layer.id === 'base' ? 8 : 10,
      undefined,
      cubic,
    );
  const cap = captureRememberedSelectionAuthoringFrame(() => state),
    before = structuredClone(state);
  expect(() => cap.prepareTrajectories(all(), paths())).toThrow(/does not change/);
  expect(state).toEqual(before);
  expect(cap.prepareTrajectories(all(), paths(curved))).toBeDefined();
});
for (const mode of ['source', 'source-data', 'output-finite', 'output-nan', 'output-budget'])
  it('rejects actual completed-output clone tampering ' + mode, () => {
    const state = fixture(),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      before = structuredClone(state),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', ((value: unknown) => {
      const out = clone(value);
      if (value && typeof value === 'object' && 'layers' in value) {
        const candidate = out as Project;
        if (candidate.layers[0].motionSpans?.[0].path) {
          hit = true;
          if (mode === 'source') state.revision++;
          if (mode === 'source-data') state.project.layers[1].keys[0].shapes[0].fill = '#0000ff';
          if (mode === 'output-finite') candidate.layers[0].keys[4].shapes[0].x++;
          if (mode === 'output-nan') candidate.layers[0].keys[4].shapes[0].x = NaN;
          if (mode === 'output-budget')
            candidate.symbols = [
              {
                id: 'too',
                name: 'Too',
                width: 1,
                height: 1,
                shapes: Array(MAX_SYMBOL_ARTWORK + 1).fill(ink('same', 0)),
              },
            ];
        }
      }
      return out;
    }) as typeof structuredClone);
    try {
      expect(() => cap.prepareTrajectories(all(), paths())).toThrow();
      expect(hit).toBe(true);
      if (mode === 'source-data') before.project.layers[1].keys[0].shapes[0].fill = '#0000ff';
      expect(state.project).toEqual(before.project);
    } finally {
      vi.unstubAllGlobals();
    }
  });

for (const mutation of ['order', 'ancestry', 'missing', 'extra'])
  it('requires exact private coverage at every later generated key ' + mutation, () => {
    const state = fixture(),
      layer = state.project.layers[1],
      key = layer.keys[2];
    if (mutation === 'order') [key.shapes[0], key.shapes[4]] = [key.shapes[4], key.shapes[0]];
    if (mutation === 'ancestry') key.shapes[1].groups = ['outer', 'other-inner'];
    if (mutation === 'missing') key.shapes.splice(4, 1);
    if (mutation === 'extra') key.shapes.push(ink('unselected', 200));
    layer.motionSpans![0].baseline = JSON.stringify(
      layer.keys.filter((key) => key.frame > 0 && key.frame < 10),
    );
    const before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      spy = vi.spyOn(spans, 'refreshBasicMotionSpan');
    expect(() => cap.prepareTrajectories(all(), paths())).toThrow(/complete/);
    expect(spy).not.toHaveBeenCalled();
    expect(state).toEqual(before);
  });
for (const sourceAligned of [false, true])
  it(
    'preserves aligned unequal compound rings and original endpoint representations ' +
      sourceAligned,
    () => {
      const state = fixture('compound');
      for (const layer of state.project.layers) {
        const end = layer.id === 'base' ? 8 : 10,
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
        refreshBasicMotionSpan(state.project, [layer.id], 0, end);
      }
      const before = structuredClone(state),
        candidate = captureRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
          all(),
          paths(curved),
        );
      for (let i = 0; i < candidate.layers.length; i++) {
        const end = i === 0 ? 8 : 10,
          layer = candidate.layers[i],
          old = state.project.layers[i];
        expect(layer.keys.filter((key) => [0, end, 12].includes(key.frame))).toEqual(
          old.keys.filter((key) => [0, end, 12].includes(key.frame)),
        );
        expect(layer.motionSpans![0].correspondence).toEqual(old.motionSpans![0].correspondence);
        expect(layer.keys[4].shapes[0].contours!.map((ring) => ring.length)).toEqual(
          old.keys[4].shapes[0].contours!.map((ring) => ring.length),
        );
      }
      expect(state).toEqual(before);
    },
  );
for (const stage of ['initial-clone', 'initial-callback', 'prepared-callback', 'final-owner'])
  for (const mutation of ['finite', 'numeric'])
    it('rejects detached trajectory tampering at ' + stage + ' ' + mutation, () => {
      const state = fixture(),
        before = structuredClone(state),
        cap = captureRememberedSelectionAuthoringFrame(() => state),
        clone = structuredClone;
      let initial: Project | undefined,
        output: Project | undefined,
        hit = false,
        finalCalls = 0;
      const mutate = (p: Project) => {
        hit = true;
        p.layers[0].keys[12].shapes = [ink('forged', mutation === 'numeric' ? NaN : 1)];
      };
      vi.stubGlobal('structuredClone', ((value: unknown) => {
        const out = clone(value);
        if (value && typeof value === 'object' && 'layers' in value) {
          const p = out as Project;
          if (!p.layers[0].motionSpans?.[0].path) {
            initial = p;
            if (stage === 'initial-clone') mutate(p);
          } else output = p;
        }
        return out;
      }) as typeof structuredClone);
      const validate = () => {
        if (
          stage === 'initial-callback' &&
          initial &&
          !initial.layers[0].motionSpans![0].path &&
          !hit
        )
          mutate(initial);
        if (
          stage === 'prepared-callback' &&
          initial?.layers[0].motionSpans![0].path &&
          !output &&
          !hit
        )
          mutate(initial);
        if (stage === 'final-owner' && output && ++finalCalls === 3) mutate(output);
      };
      try {
        expect(() => cap.prepareTrajectories(all(), paths(), { validate })).toThrow();
        expect(hit).toBe(true);
        expect(state).toEqual(before);
      } finally {
        vi.unstubAllGlobals();
      }
    });
it('admits the actual aggregate artwork capacity without moving library artwork', () => {
  const state = fixture();
  state.project.symbols = [
    {
      id: 'large',
      name: 'Large',
      width: 1,
      height: 1,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
        ...ink(String(i), 0),
        width: 1,
        height: 1,
      })),
    },
  ];
  const before = structuredClone(state.project.symbols),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    candidate = cap.prepareTrajectories(all(['base']), paths(cubic, ['base']));
  expect(candidate.symbols).toEqual(before);
  expect(candidate.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  cap.dispose();
}, 60000);
it('rejects original aggregate overflow before private trajectory capture', () => {
  const state = fixture();
  state.project.symbols = [
    {
      id: 'over',
      name: 'Over',
      width: 1,
      height: 1,
      shapes: Array(MAX_SYMBOL_ARTWORK + 1).fill(ink('same', 0)),
    },
  ];
  expect(() => captureRememberedSelectionAuthoringFrame(() => state)).toThrow(
    /symbol artwork budget/,
  );
});

it('rejects growing control arrays during raw reads without discarding new controls', () => {
  const state = fixture(),
    cap = captureRememberedSelectionAuthoringFrame(() => state),
    points = [{ x: 30, y: 45 }];
  Object.defineProperty(points[0], 'x', {
    get() {
      points.push({ x: 40, y: 20 });
      return 30;
    },
  });
  expect(() =>
    cap.prepareTrajectories(all(), [
      { ...paths()[0], path: { ...waypoint, waypoints: points } },
      paths()[1],
    ]),
  ).toThrow(/changed while being read/);
  expect(cap.prepareTrajectories(all(), paths())).toBeDefined();
});
it('canonical original path snapshots reject no-ops despite saved property ordering', () => {
  const state = fixture();
  for (const layer of state.project.layers) {
    refreshBasicMotionSpan(
      state.project,
      [layer.id],
      0,
      layer.id === 'base' ? 8 : 10,
      undefined,
      cubic,
    );
    layer.motionSpans![0].path = { endY: 20, startY: 50, endX: -15, startX: 20 };
  }
  expect(() =>
    captureRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(all(), paths()),
  ).toThrow(/does not change/);
});
it('preserves explicit false versus omitted route option representations', () => {
  const state = fixture();
  for (const layer of state.project.layers)
    refreshBasicMotionSpan(state.project, [layer.id], 0, layer.id === 'base' ? 8 : 10, undefined, {
      ...cubic,
      distance: false,
    });
  const out = captureRememberedSelectionAuthoringFrame(() => state).prepareTrajectories(
    all(),
    paths(),
  );
  expect(Object.hasOwn(out.layers[0].motionSpans![0].path!, 'distance')).toBe(false);
  expect(state.project.layers[0].motionSpans![0].path!.distance).toBe(false);
});

for (const swallowed of [false, true])
  it('invalidates raw getter reentry even when swallowed ' + swallowed, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureRememberedSelectionAuthoringFrame(() => state),
      request = paths()[0];
    Object.defineProperty(request, 'path', {
      get() {
        try {
          void cap.choices;
        } catch (error) {
          if (!swallowed) throw error;
        }
        return cubic;
      },
    });
    expect(() => cap.prepareTrajectories(all(), [request, paths()[1]])).toThrow();
    expect(() => cap.assertCurrent()).toThrow(/invalidated/);
    expect(state).toEqual(before);
  });

for (const stage of ['initial', 'completed'])
  it('protects own-undefined route metadata during ' + stage + ' cloning', () => {
    const state = fixture();
    state.project.layers[1].folderId = undefined;
    const cap = captureRememberedSelectionAuthoringFrame(() => state),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', ((value: unknown) => {
      const out = clone(value);
      if (out && typeof out === 'object' && 'layers' in out) {
        const p = out as Project,
          complete = !!p.layers[0].motionSpans?.[0].path;
        if (complete === (stage === 'completed') && Object.hasOwn(p.layers[1], 'folderId')) {
          hit = true;
          delete p.layers[1].folderId;
        }
      }
      return out;
    }) as typeof structuredClone);
    try {
      expect(() => cap.prepareTrajectories(all(), paths())).toThrow();
      expect(hit).toBe(true);
      expect(Object.hasOwn(state.project.layers[1], 'folderId')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

for (const timing of ['before', 'late'])
  it('rejects own-undefined original source changes ' + timing, () => {
    const state = fixture();
    state.project.layers[1].folderId = undefined;
    let armed = false,
      hit = false;
    const cap = captureRememberedSelectionAuthoringFrame(() => {
      if (armed && !hit) {
        hit = true;
        delete state.project.layers[1].folderId;
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
          'layers' in out &&
          (out as Project).layers[0].motionSpans?.[0].path
        )
          armed = true;
        return out;
      }) as typeof structuredClone);
    }
    try {
      expect(() => cap.prepareTrajectories(all(), paths())).toThrow();
      expect(hit).toBe(true);
      expect(Object.hasOwn(state.project.layers[1], 'folderId')).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
