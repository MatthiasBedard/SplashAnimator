import { afterEach, expect, it, vi } from 'vitest';
import { newProject, validateProject, type Vector, type Project } from '../packages/document/src';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import {
  captureRememberedSelectionAuthoringFrame,
  type SampledUnitRequest,
} from '../packages/animation/src/selection-motion-owner';
import type { GroupAuthoringSource } from '../packages/animation/src/group-motion-owner';
import type { MotionPath } from '../packages/document/src/motion-path';
import type { TrajectoryRequest } from '../packages/animation/src/trajectory-input';
import { matrix } from '../packages/geometry/src';
import {
  createSampledSelectionTrajectoryContext,
  resolveSampledSelectionTrajectories,
  prepareSampledSelectionTrajectories,
  sampleSampledSelectionTrajectories,
  admitSampledSelectionTrajectoryPublication,
  type SampledSelectionCubicControls,
  type SampledSelectionTrajectoryContext,
} from '../apps/editor/src/sampled-selection-trajectory-editor';
import {
  createSampledSelectionContext,
  admitSampledSelectionPublication,
  type SampledSelectionEdit,
  type SampledSelectionState,
  type SampledSelectionPose,
} from '../apps/editor/src/sampled-selection-editor';
import * as document from '../packages/document/src';
import * as trajectory from '../packages/animation/src/selection-trajectory';

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

function fixture(mode = 'plain') {
  const source = rootFixture(mode);
  source.project.layers[1].folderId = undefined;
  const state: SampledSelectionState = {
    ...source,
    signature: JSON.stringify(source.project),
    policy: 0,
    groups: false,
    pick: null,
    children: false,
    prepared: null,
    stamp: 'route',
    blocked: false,
  };
  const hooks: {
    read?: () => void;
    snapshot?: (project: Project) => Project;
    sample?: (project: Project, frame: number) => SampledSelectionPose;
  } = {};
  const sample = vi.fn(
    (project: Project, frame: number) =>
      hooks.sample?.(project, frame) ?? {
        scene: [],
        rendered: structuredClone(
          project.layers[0].keys.find((key) => key.frame === frame)!.shapes,
        ),
      },
  );
  const context = createSampledSelectionTrajectoryContext(
    () => {
      hooks.read?.();
      return state;
    },
    (project) => hooks.snapshot?.(project) ?? structuredClone(project),
    sample,
  )!;
  return { state, context, hooks, sample };
}
const controls = (ids = ['base', 'extra']): SampledSelectionCubicControls[] =>
  ids.map((layerId) => ({ layerId, ...cubic }));
const prepare = (f: ReturnType<typeof fixture>, input: () => void = () => {}) =>
  prepareSampledSelectionTrajectories(f.context, all(), controls(), input);

for (const mode of ['plain', 'affine', 'reflected', 'compound', 'loop', 'once', 'single', 'movie'])
  it('prepares original per-track cubic edits without promotion ' + mode, () => {
    const f = fixture(mode),
      before = structuredClone(f.state.project),
      hints = resolveSampledSelectionTrajectories(f.context, all(), () => {});
    expect(
      hints.routes.map((route) => [route.layerId, route.shapeId, route.start, route.end]),
    ).toEqual([
      ['base', 'r', 0, 8],
      ['extra', 'r', 0, 10],
    ]);
    const edit = prepare(f),
      expected = captureRememberedSelectionAuthoringFrame(() => ({
        project: f.state.project,
        revision: f.state.revision,
        frame: f.state.frame,
      })).prepareTrajectories(all(), paths());
    expect(edit.candidate).toEqual(expected);
    expect(edit.kind).toBe('selection-trajectories');
    expect(edit.snapshot).toEqual(before);
    expect(f.state.project).toEqual(before);
    for (let i = 0; i < 2; i++) {
      const old = before.layers[i],
        layer = edit.candidate.layers[i],
        end = i === 0 ? 8 : 10;
      expect(layer.motionSpans).toHaveLength(1);
      expect(layer.keys.filter((key) => [0, end, 12].includes(key.frame))).toEqual(
        old.keys.filter((key) => [0, end, 12].includes(key.frame)),
      );
      for (let n = 0; n < 7; n++) {
        expect(withoutXY(layer.keys[4].shapes[n])).toEqual(withoutXY(old.keys[4].shapes[n]));
        expect(matrix(layer.keys[4].shapes[n]).slice(0, 4)).toEqual(
          matrix(old.keys[4].shapes[n]).slice(0, 4),
        );
      }
    }
    const pose = sampleSampledSelectionTrajectories(edit);
    expect(pose.rendered).toEqual(edit.candidate.layers[0].keys[4].shapes);
    expect(f.sample).toHaveBeenCalledWith(edit.candidate, 4);
    admitSampledSelectionTrajectoryPublication(edit);
  });
it('initializes original saved options and retains literal false without silently enabling anything', () => {
  const f = fixture();
  for (const layer of f.state.project.layers)
    refreshBasicMotionSpan(
      f.state.project,
      [layer.id],
      0,
      layer.id === 'base' ? 8 : 10,
      undefined,
      { ...cubic, distance: false, tangent: false },
    );
  f.state.signature = JSON.stringify(f.state.project);
  const context = createSampledSelectionTrajectoryContext(
    () => f.state,
    (p) => structuredClone(p),
    () => ({ scene: [], rendered: [] }),
  )!;
  const hints = resolveSampledSelectionTrajectories(context, all(), () => {});
  expect(hints.routes[0].path).toEqual({ ...cubic, distance: false, tangent: false });
  const input = controls().map((value) => ({ ...value, startY: 60 })),
    edit = prepareSampledSelectionTrajectories(context, all(), input, () => {});
  expect(edit.candidate.layers[0].motionSpans![0].path).toEqual({
    ...cubic,
    startY: 60,
    distance: false,
    tangent: false,
  });
});
it('never uses detached hints/proposals to initialize later ownership or saved paths', () => {
  const f = fixture(),
    hints = resolveSampledSelectionTrajectories(f.context, all(), () => {});
  hints.owner.tracks[0].shapeIds = [];
  hints.routes[0].path.startX = NaN;
  hints.routes[0].shapeId = 'forged';
  const edit = prepare(f);
  expect(edit.owner.tracks[0].shapeIds).toHaveLength(7);
  expect(edit.trajectories[0].shapeId).toBe('r');
  expect(edit.trajectories[0].path).toEqual(cubic);
});
it('supports independently changed tracks and single-track selection without touching other recipes', () => {
  const f = fixture(),
    one = prepareSampledSelectionTrajectories(
      f.context,
      all(['base']),
      controls(['base']),
      () => {},
    );
  expect(one.candidate.layers[1]).toEqual(f.state.project.layers[1]);
  const values = controls();
  values[1].startY = 80;
  const two = prepareSampledSelectionTrajectories(f.context, all(), values, () => {});
  expect(two.candidate.layers[0].motionSpans![0].path!.startY).toBe(50);
  expect(two.candidate.layers[1].motionSpans![0].path!.startY).toBe(80);
});
for (const path of [
  waypoint,
  curved,
  { ...cubic, curvedWaypoints: false },
  { ...cubic, tangent: true },
])
  it('rejects unsupported saved route scope without converting it ' + JSON.stringify(path), () => {
    const source = rootFixture();
    for (const layer of source.project.layers)
      refreshBasicMotionSpan(
        source.project,
        [layer.id],
        0,
        layer.id === 'base' ? 8 : 10,
        undefined,
        path,
      );
    const state: SampledSelectionState = {
      ...source,
      signature: JSON.stringify(source.project),
      policy: 0,
      groups: false,
      pick: null,
      children: false,
      prepared: null,
      stamp: 'route',
      blocked: false,
    };
    const context = createSampledSelectionTrajectoryContext(
      () => state,
      (p) => structuredClone(p),
      () => ({ scene: [], rendered: [] }),
    )!;
    expect(() => resolveSampledSelectionTrajectories(context, all(), () => {})).toThrow();
    expect(() =>
      prepareSampledSelectionTrajectories(context, all(), controls(), () => {}),
    ).toThrow();
  });
for (const selected of [
  [],
  [pick('base', 'r')],
  [pick('base', 'c')],
  [pick('missing', 'r')],
  [...all(), pick('base', 'r')],
])
  it('rejects incomplete/overlapping original selection ' + JSON.stringify(selected), () => {
    const f = fixture(),
      before = structuredClone(f.state.project);
    expect(() =>
      prepareSampledSelectionTrajectories(f.context, selected, controls(), () => {}),
    ).toThrow();
    expect(f.state.project).toEqual(before);
    expect(prepare(f)).toBeDefined();
  });
for (const input of [
  null,
  {},
  [],
  [controls()[0]],
  [...controls(), controls()[0]],
  [{ ...controls()[0], layerId: 'missing' }, controls()[1]],
  [{ ...controls()[0], shapeId: 'forged' }, controls()[1]],
  [null],
  [{ ...controls()[0], startX: NaN }, controls()[1]],
  [{ ...controls()[0], endY: Infinity }, controls()[1]],
  [{ ...controls()[0], startY: '20' }, controls()[1]],
  [{ ...controls()[0], endX: undefined }, controls()[1]],
  [{ ...controls()[0], startX: 0, startY: 0, endX: 0, endY: 0 }, controls()[1]],
])
  it('rejects malformed/nonfinite/unchanged cubic controls ' + JSON.stringify(input), () => {
    const f = fixture(),
      before = structuredClone(f.state.project);
    expect(() =>
      prepareSampledSelectionTrajectories(f.context, all(), input as never, () => {}),
    ).toThrow();
    expect(f.state.project).toEqual(before);
    expect(prepare(f)).toBeDefined();
  });
for (const field of [
  'project',
  'revision',
  'frame',
  'policy',
  'groups',
  'pick',
  'children',
  'prepared',
  'signature',
  'stamp',
  'blocked',
  'data',
  'undefined',
])
  it('invalidates source/context edits before publication ' + field, () => {
    const f = fixture(),
      edit = prepare(f);
    if (field === 'project') f.state.project = structuredClone(f.state.project);
    if (field === 'revision') f.state.revision++;
    if (field === 'frame') f.state.frame++;
    if (field === 'policy') f.state.policy++;
    if (field === 'groups') f.state.groups = true;
    if (field === 'pick') f.state.pick = {};
    if (field === 'children') f.state.children = true;
    if (field === 'prepared') f.state.prepared = {};
    if (field === 'signature') f.state.signature += '!';
    if (field === 'stamp') f.state.stamp += '!';
    if (field === 'blocked') f.state.blocked = true;
    if (field === 'data') f.state.project.layers[0].keys[0].shapes[0].fill = '#0000ff';
    if (field === 'undefined') delete f.state.project.layers[1].folderId;
    const after = structuredClone(f.state.project);
    expect(() => admitSampledSelectionTrajectoryPublication(edit)).toThrow();
    expect(f.state.project).toEqual(after);
  });
for (const field of ['frame', 'revision', 'stamp', 'validate', 'snapshot', 'sample'])
  it('rejects replaced public context fields ' + field, () => {
    const f = fixture(),
      edit = prepare(f);
    Object.assign(f.context, {
      [field]: ['frame', 'revision'].includes(field)
        ? 999
        : field === 'stamp'
          ? 'forged'
          : () => {},
    });
    expect(() => admitSampledSelectionTrajectoryPublication(edit)).toThrow();
  });
for (const field of ['kind', 'snapshot', 'candidate', 'owner', 'trajectories', 'validate', 'extra'])
  it('rejects replaced edit identity/operation fields ' + field, () => {
    const f = fixture(),
      edit = prepare(f);
    if (field === 'extra') Object.defineProperty(edit, 'rotation', { value: { degrees: 0 } });
    else
      Object.assign(edit, {
        [field]:
          field === 'kind'
            ? 'rotation'
            : field === 'validate'
              ? () => {}
              : structuredClone(edit[field as 'snapshot' | 'candidate' | 'owner' | 'trajectories']),
      });
    expect(() => admitSampledSelectionTrajectoryPublication(edit)).toThrow();
  });
for (const field of ['candidate', 'numeric', 'snapshot', 'owner', 'path', 'undefined'])
  it('rejects detached content tampering ' + field, () => {
    const f = fixture(),
      edit = prepare(f);
    if (field === 'candidate') edit.candidate.layers[0].keys[4].shapes[0].x++;
    if (field === 'numeric') edit.candidate.layers[0].keys[4].shapes[0].x = NaN;
    if (field === 'snapshot') edit.snapshot.layers[0].name = 'changed';
    if (field === 'owner') edit.owner.tracks[0].shapeIds = [];
    if (field === 'path') edit.trajectories[0].path.startY++;
    if (field === 'undefined') delete edit.candidate.layers[1].folderId;
    expect(() => admitSampledSelectionTrajectoryPublication(edit)).toThrow();
    expect(prepare(f)).toBeDefined();
  });
it('rejects forged/spread edits and unbranded legacy contexts', () => {
  const f = fixture(),
    edit = prepare(f);
  expect(() => admitSampledSelectionTrajectoryPublication({ ...edit })).toThrow();
  expect(() => sampleSampledSelectionTrajectories({ ...edit })).toThrow();
  const legacy = createSampledSelectionContext(
    () => f.state,
    (p) => structuredClone(p),
    () => ({ scene: [], rendered: [] }),
  )!;
  if (false) {
    // @ts-expect-error Legacy contexts cannot authorize whole-route edits.
    prepareSampledSelectionTrajectories(legacy, all(), controls(), () => {});
  }
  expect(() =>
    prepareSampledSelectionTrajectories(
      legacy as SampledSelectionTrajectoryContext,
      all(),
      controls(),
      () => {},
    ),
  ).toThrow();
});
it('snapshots every raw numeric/identity getter once', () => {
  const f = fixture(),
    reads = { layer: 0, id: 0, targetLayer: 0, x: 0, y: 0, endX: 0, endY: 0 };
  const selection = [
    {
      get layerId() {
        reads.layer++;
        return 'base';
      },
      get shapeId() {
        reads.id++;
        return 'r';
      },
    },
    ...all(['base']).filter((value) => value.shapeId !== 'r'),
  ];
  const control = {
    get layerId() {
      reads.targetLayer++;
      return 'base';
    },
    get startX() {
      reads.x++;
      return 20;
    },
    get startY() {
      reads.y++;
      return 50;
    },
    get endX() {
      reads.endX++;
      return -15;
    },
    get endY() {
      reads.endY++;
      return 20;
    },
  };
  prepareSampledSelectionTrajectories(f.context, selection, [control], () => {});
  expect(reads).toEqual({ layer: 1, id: 1, targetLayer: 1, x: 1, y: 1, endX: 1, endY: 1 });
});
for (const getter of ['identity', 'target', 'length'])
  it('rejects source/array changes during raw getters ' + getter, () => {
    const f = fixture(),
      selected = all(),
      values = controls();
    if (getter === 'identity')
      Object.defineProperty(selected[0], 'shapeId', {
        get() {
          f.state.revision++;
          return 'r';
        },
      });
    if (getter === 'target')
      Object.defineProperty(values[0], 'startX', {
        get() {
          f.state.revision++;
          return 20;
        },
      });
    if (getter === 'length')
      Object.defineProperty(values, 0, {
        get() {
          values.push(controls()[0]);
          return controls()[0];
        },
      });
    expect(() =>
      prepareSampledSelectionTrajectories(f.context, selected, values, () => {}),
    ).toThrow();
  });
it('rejects changed-and-restored input revisions even when target values match again', () => {
  const f = fixture();
  let revision = 0;
  const input = () => {
    if (revision !== 0) throw Error('changed input');
  };
  const values = controls(),
    edit = prepareSampledSelectionTrajectories(f.context, all(), values, input);
  values[0].startY++;
  revision++;
  values[0].startY--;
  revision++;
  expect(() => admitSampledSelectionTrajectoryPublication(edit)).toThrow(/changed input/);
});
for (const asynchronous of [false, true])
  it('rejects thrown/asynchronous input admission ' + asynchronous, () => {
    const f = fixture();
    expect(() =>
      prepare(
        f,
        asynchronous
          ? () => Promise.resolve()
          : () => {
              throw Error('input');
            },
      ),
    ).toThrow();
    expect(prepare(f)).toBeDefined();
  });
it('rejects snapshot replacement without consuming original valid context', () => {
  const f = fixture();
  f.hooks.snapshot = (project) => {
    const p = structuredClone(project);
    p.layers[0].keys[0].shapes[0].x++;
    return p;
  };
  expect(() => prepare(f)).toThrow();
  f.hooks.snapshot = undefined;
  expect(prepare(f)).toBeDefined();
});
for (const phase of ['source', 'snapshot', 'input', 'sample', 'publication'])
  for (const swallow of [false, true])
    it('rejects reentry in ' + phase + ' swallowed=' + swallow, () => {
      const f = fixture();
      let hit = false;
      const attempt = (run: () => unknown) => {
        if (hit) return;
        hit = true;
        try {
          run();
        } catch (error) {
          if (!swallow) throw error;
        }
      };
      if (phase === 'source') f.hooks.read = () => attempt(() => f.context.validate());
      if (phase === 'snapshot')
        f.hooks.snapshot = (project) => {
          attempt(() => f.context.snapshot());
          return structuredClone(project);
        };
      if (phase === 'source' || phase === 'snapshot') {
        expect(() => prepare(f)).toThrow();
      }
      if (phase === 'input') expect(() => prepare(f, () => attempt(() => prepare(f)))).toThrow();
      if (phase === 'sample') {
        const edit = prepare(f);
        f.hooks.sample = () => {
          attempt(() => sampleSampledSelectionTrajectories(edit));
          return { scene: [], rendered: [] };
        };
        expect(() => sampleSampledSelectionTrajectories(edit)).toThrow();
      }
      if (phase === 'publication') {
        const edit = prepare(f),
          validate = document.validateProject;
        vi.spyOn(document, 'validateProject').mockImplementation((...args) => {
          attempt(() => prepare(f));
          return validate(...args);
        });
        expect(() => admitSampledSelectionTrajectoryPublication(edit)).toThrow();
      }
      expect(hit).toBe(true);
    });
for (const phase of ['sample', 'publication'])
  it(
    'rejects late prepared candidate edits during ' + phase + ' with a fresh original retry',
    () => {
      const f = fixture(),
        edit = prepare(f);
      let hit = false;
      if (phase === 'sample') {
        f.hooks.sample = () => {
          hit = true;
          edit.candidate.layers[0].keys[4].shapes[0].x++;
          return { scene: [], rendered: [] };
        };
        expect(() => sampleSampledSelectionTrajectories(edit)).toThrow();
        f.hooks.sample = undefined;
      } else {
        const validate = document.validateProject;
        vi.spyOn(document, 'validateProject').mockImplementation((...args) => {
          const out = validate(...args);
          if (args[0] === edit.candidate) {
            hit = true;
            edit.candidate.layers[0].keys[4].shapes[0].x++;
          }
          return out;
        });
        expect(() => admitSampledSelectionTrajectoryPublication(edit)).toThrow();
        vi.restoreAllMocks();
      }
      expect(hit).toBe(true);
      expect(prepare(f)).toBeDefined();
    },
  );
it('rejects final source-read accessors before executing them', () => {
  const f = fixture(),
    edit = prepare(f);
  let armed = true;
  const getter = vi.fn(() => {
    f.state.project.name = 'late';
    return edit.candidate;
  });
  f.hooks.read = () => {
    if (armed) {
      armed = false;
      Object.defineProperty(edit, 'candidate', { enumerable: true, get: getter });
    }
  };
  expect(() => admitSampledSelectionTrajectoryPublication(edit)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it('rejects optional source metadata changed during a numeric getter before returning an edit', () => {
  const f = fixture(),
    values = controls();
  Object.defineProperty(values[0], 'startX', {
    get() {
      delete f.state.project.layers[1].folderId;
      return 20;
    },
  });
  expect(() => prepareSampledSelectionTrajectories(f.context, all(), values, () => {})).toThrow();
  expect(Object.hasOwn(f.state.project.layers[1], 'folderId')).toBe(false);
});
it('rejects optional source metadata changed after complete hint cloning', () => {
  const f = fixture(),
    clone = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', ((value: unknown) => {
    const out = clone(value);
    if (out && typeof out === 'object' && 'owner' in out && 'routes' in out) {
      hit = true;
      delete f.state.project.layers[1].folderId;
    }
    return out;
  }) as typeof structuredClone);
  expect(() => resolveSampledSelectionTrajectories(f.context, all(), () => {})).toThrow();
  expect(hit).toBe(true);
});
it('rejects a late nested output getter before executing it', () => {
  const f = fixture(),
    edit = prepare(f);
  let armed = true;
  const name = edit.candidate.name,
    getter = vi.fn(() => {
      f.state.project.name = 'late';
      return name;
    });
  f.hooks.read = () => {
    if (armed) {
      armed = false;
      Object.defineProperty(edit.candidate, 'name', { enumerable: true, get: getter });
    }
  };
  expect(() => admitSampledSelectionTrajectoryPublication(edit)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
it('rejects own-undefined loss from the original snapshot', () => {
  const f = fixture();
  f.hooks.snapshot = (source) => {
    const p = structuredClone(source);
    delete p.layers[1].folderId;
    return p;
  };
  expect(() => prepare(f)).toThrow();
  f.hooks.snapshot = undefined;
  expect(prepare(f)).toBeDefined();
});
for (const tracks of [['base'], ['base', 'extra']])
  it(
    'bounds complete live metadata scans across nested preparation for ' + tracks.join('/'),
    () => {
      const f = fixture(),
        spy = vi.spyOn(trajectory, 'selectionTrajectoryStamp');
      prepareSampledSelectionTrajectories(f.context, all(tracks), controls(tracks), () => {});
      const scans = spy.mock.calls.filter(([value]) => value === f.state.project).length;
      expect(scans).toBeGreaterThan(0);
      expect(scans).toBeLessThanOrEqual(6);
    },
  );

it('cannot enter the promotion publisher through its type or runtime operation tag', () => {
  const f = fixture(),
    edit = prepare(f);
  if (false) {
    // @ts-expect-error Whole trajectories are incompatible with promotion edits.
    admitSampledSelectionPublication(edit);
  }
  expect(() => admitSampledSelectionPublication(edit as unknown as SampledSelectionEdit)).toThrow(
    /dedicated publication/,
  );
  admitSampledSelectionTrajectoryPublication(edit);
});

it('rejects finite later-track coordinate overflow atomically and permits a fresh valid retry', () => {
  const f = fixture(),
    before = structuredClone(f.state.project),
    values = controls();
  values[1].startX = Number.MAX_VALUE;
  values[1].endX = Number.MAX_VALUE;
  expect(() => prepareSampledSelectionTrajectories(f.context, all(), values, () => {})).toThrow();
  expect(f.state.project).toEqual(before);
  expect(prepare(f)).toBeDefined();
});
