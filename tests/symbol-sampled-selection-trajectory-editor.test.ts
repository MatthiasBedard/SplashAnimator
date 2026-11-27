import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  symbolLayers,
  validateProject,
  type SymbolDefinition,
  type Vector,
} from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { captureSymbolRememberedSelectionAuthoringFrame } from '../packages/animation/src/symbol-selection-motion-owner';
import {
  admitSymbolSampledSelectionPublication,
  type SymbolSampledSelectionState,
} from '../apps/editor/src/symbol-sampled-selection-editor';
import {
  createSymbolSampledSelectionTrajectoryContext,
  resolveSymbolSampledSelectionTrajectories,
  prepareSymbolSampledSelectionTrajectories,
  sampleSymbolSampledSelectionTrajectories,
  admitSymbolSampledSelectionTrajectoryPublication,
} from '../apps/editor/src/symbol-sampled-selection-trajectory-editor';
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const project = newProject();
  project.duration = 14;
  const ink = (id: string, x: number, groups?: string[]): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y: 10,
    width: 12,
    height: 12,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    ...(groups ? { groups } : {}),
  });
  project.layers = ['@base', 'extra'].map((id, i) => ({
    id,
    name: id,
    visible: true,
    locked: false,
    keys: [
      {
        frame: 0,
        shapes: [
          ink('r', 0),
          ink('a', 20, ['outer', 'inner']),
          ink('b', 40, ['outer']),
          ink('other', 100),
        ],
      },
      {
        frame: i ? 10 : 8,
        shapes: [
          ink('r', 80),
          ink('a', 100, ['outer', 'inner']),
          ink('b', 120, ['outer']),
          ink('other', 180),
        ],
      },
      { frame: 12, shapes: [] },
    ],
  }));
  createBasicMotionSpan(project, ['@base'], 0, 8, 'linear');
  createBasicMotionSpan(project, ['extra'], 0, 10, 'linear');
  const base = project.layers[0];
  const definition: SymbolDefinition = {
    id: 'sprite',
    name: 'Sprite',
    width: 400,
    height: 240,
    shapes: base.keys[0].shapes,
    timeline: {
      duration: 14,
      keys: base.keys.slice(1),
      motionSpans: base.motionSpans,
      layers: [project.layers[1]],
    },
  };
  const state: SymbolSampledSelectionState = {
    definition,
    symbols: [definition],
    assets: [],
    revision: 3,
    frame: 4,
    policy: 0,
    groups: false,
    pick: null,
    prepared: null,
    blocked: false,
  };
  let enclosing = true,
    candidateAdmission = true;
  const validateEnclosing = vi.fn(() => {
    if (!enclosing) throw Error('enclosing changed');
  });
  const validateCandidate = vi.fn((candidate: SymbolDefinition) => {
    if (!candidateAdmission) throw Error('candidate rejected');
    validateProject({
      ...project,
      layers: symbolLayers(candidate),
      assets: state.assets,
      symbols: state.symbols.map((s) => (s.id === candidate.id ? candidate : s)),
    });
  });
  const make = () =>
    createSymbolSampledSelectionTrajectoryContext(
      () => state,
      validateEnclosing,
      validateCandidate,
      (candidate) => {
        const source = {
          ...state,
          definition: candidate,
          symbols: state.symbols.map((s) => (s.id === candidate.id ? candidate : s)),
        };
        const capture = captureSymbolRememberedSelectionAuthoringFrame(() => source);
        try {
          return { scene: capture.scene, symbols: [candidate] };
        } finally {
          capture.dispose();
        }
      },
    )!;
  return {
    state,
    context: make(),
    make,
    validateEnclosing,
    validateCandidate,
    rejectEnclosing: (value = false) => {
      enclosing = value;
    },
    rejectCandidate: (value = false) => {
      candidateAdmission = value;
    },
  };
}

const selected = ['@base', 'extra'].flatMap((layerId) =>
  ['r', 'a', 'other'].map((shapeId) => ({ layerId, shapeId })),
);
const controls = ['@base', 'extra'].map((layerId) => ({
  layerId,
  startX: 20,
  startY: 45,
  endX: -15,
  endY: 25,
}));
const prepare = (f: ReturnType<typeof fixture>, input = () => {}) =>
  prepareSymbolSampledSelectionTrajectories(f.context, selected, controls, input);
it('resolves detached original complete routes and prepares unsplit actual-resource candidates', () => {
  const f = fixture(),
    before = structuredClone(f.state),
    hints = resolveSymbolSampledSelectionTrajectories(f.context, selected, () => {});
  expect(hints.owner.units).toHaveLength(6);
  expect(hints.routes).toHaveLength(2);
  hints.routes[0].path.startY = 999;
  const edit = prepare(f);
  expect(edit.snapshot).toEqual(before.definition);
  expect(f.state).toEqual(before);
  for (const [i, layer] of symbolLayers(edit.candidate).entries()) {
    const old = symbolLayers(before.definition)[i];
    expect(layer.motionSpans).toHaveLength(1);
    expect(layer.motionSpans![0].id).toBe(old.motionSpans![0].id);
    expect(layer.motionSpans![0].path?.startY).toBe(45);
    expect(layer.keys[0]).toEqual(old.keys[0]);
    expect(layer.keys.at(-1)).toEqual(old.keys.at(-1));
    expect(layer.keys.find((k) => k.frame === (i ? 10 : 8))).toEqual(
      old.keys.find((k) => k.frame === (i ? 10 : 8)),
    );
  }
  expect(sampleSymbolSampledSelectionTrajectories(edit).scene).toHaveLength(2);
  admitSymbolSampledSelectionTrajectoryPublication(edit);
  expect(() => admitSymbolSampledSelectionPublication(edit as never)).toThrow(/dedicated/);
  expect(() => admitSymbolSampledSelectionTrajectoryPublication({ ...edit })).toThrow();
});
for (const key of [
  'definition',
  'symbols',
  'assets',
  'revision',
  'frame',
  'policy',
  'groups',
  'pick',
  'prepared',
  'blocked',
] as const)
  it('owns original ' + key, () => {
    const f = fixture(),
      edit = prepare(f);
    if (['definition', 'symbols', 'assets'].includes(key))
      f.state[key] = structuredClone(f.state[key]) as never;
    else if (key === 'revision' || key === 'frame' || key === 'policy') f.state[key]++;
    else if (key === 'groups' || key === 'blocked') f.state[key] = true;
    else if (key === 'pick' || key === 'prepared') f.state[key] = {};
    expect(() => admitSymbolSampledSelectionTrajectoryPublication(edit)).toThrow();
  });
for (const key of ['candidate', 'snapshot', 'owner', 'trajectories', 'validate', 'kind'] as const)
  it('rejects replaced output ' + key, () => {
    const f = fixture(),
      edit = prepare(f);
    (edit as unknown as Record<string, unknown>)[key] =
      key === 'validate' ? () => {} : key === 'kind' ? 'other' : structuredClone(edit[key]);
    expect(() => admitSymbolSampledSelectionTrajectoryPublication(edit)).toThrow();
  });
for (const value of [NaN, Infinity, -Infinity, '1', null, undefined])
  it('rejects raw numeric ' + String(value), () => {
    const f = fixture();
    expect(() =>
      prepareSymbolSampledSelectionTrajectories(
        f.context,
        selected,
        [{ ...controls[0], startY: value as number }, controls[1]],
        () => {},
      ),
    ).toThrow();
  });
it('rejects incomplete units, unchanged tracks and missing track controls', () => {
  const f = fixture();
  expect(() =>
    prepareSymbolSampledSelectionTrajectories(f.context, selected.slice(1), controls, () => {}),
  ).toThrow();
  expect(() =>
    prepareSymbolSampledSelectionTrajectories(f.context, selected, controls.slice(1), () => {}),
  ).toThrow();
  expect(() =>
    prepareSymbolSampledSelectionTrajectories(
      f.context,
      selected,
      controls.map((c) => ({ ...c, startX: 0, startY: 0, endX: 0, endY: 0 })),
      () => {},
    ),
  ).toThrow();
});
it('rejects strong output NaN and optional metadata loss', () => {
  for (const field of ['nan', 'undefined']) {
    const f = fixture();
    f.state.definition.multiFramePivot = undefined;
    f.context = f.make();
    const edit = prepare(f);
    if (field === 'nan') symbolLayers(edit.candidate)[0].keys[4].shapes[0].x = NaN;
    else delete edit.candidate.multiFramePivot;
    expect(() => admitSymbolSampledSelectionTrajectoryPublication(edit)).toThrow();
  }
});
it('rejects actual source changes from raw control getters and permits fresh retries', () => {
  const f = fixture();
  expect(() =>
    prepareSymbolSampledSelectionTrajectories(
      f.context,
      selected,
      [
        {
          ...controls[0],
          get startY() {
            f.state.policy++;
            return 45;
          },
        },
        controls[1],
      ],
      () => {},
    ),
  ).toThrow();
  const retry = f.make();
  expect(() =>
    prepareSymbolSampledSelectionTrajectories(retry, selected, controls, () => {}),
  ).not.toThrow();
});
it('rejects asynchronous input and swallowed reentry', () => {
  let f = fixture();
  expect(() =>
    prepareSymbolSampledSelectionTrajectories(f.context, selected, controls, (() =>
      Promise.resolve()) as never),
  ).toThrow();
  f = fixture();
  expect(() =>
    prepare(f, () => {
      try {
        prepare(f);
      } catch {}
    }),
  ).toThrow();
});
it('rejects completed candidate mutation in actual enclosing candidate validation', () => {
  const f = fixture();
  f.validateCandidate.mockImplementationOnce((candidate) => {
    symbolLayers(candidate)[0].keys[4].shapes[0].x++;
  });
  expect(() => prepare(f)).toThrow();
});
it('rejects enclosing publication and restores fresh source-valid preparation', () => {
  const f = fixture(),
    edit = prepare(f);
  f.rejectEnclosing();
  expect(() => admitSymbolSampledSelectionTrajectoryPublication(edit)).toThrow();
  f.rejectEnclosing(true);
  expect(() => prepare(f)).not.toThrow();
});
it('rejects candidate output changed by final source admission', () => {
  const f = fixture(),
    edit = prepare(f);
  f.validateEnclosing.mockImplementationOnce(() => {
    edit.candidate.name = 'tampered';
  });
  expect(() => admitSymbolSampledSelectionTrajectoryPublication(edit)).toThrow();
});
it('rejects nonfinite source before opaque context capture', () => {
  const f = fixture();
  f.state.definition.width = NaN;
  expect(() => f.make()).toThrow();
});

it('rejects asynchronous public operations and samplers', () => {
  const f = fixture();
  expect(() => f.context.operation(() => Promise.resolve())).toThrow(/synchronous/);
  const context = createSymbolSampledSelectionTrajectoryContext(
    () => f.state,
    f.validateEnclosing,
    f.validateCandidate,
    (() => Promise.resolve({ scene: [], symbols: [] })) as never,
  )!;
  const edit = prepareSymbolSampledSelectionTrajectories(context, selected, controls, () => {});
  expect(() => sampleSymbolSampledSelectionTrajectories(edit)).toThrow(/synchronous/);
});
it('protects original strong source optional metadata through final admission', () => {
  const f = fixture();
  f.state.definition.multiFramePivot = undefined;
  f.context = f.make();
  const edit = prepare(f);
  delete f.state.definition.multiFramePivot;
  expect(() => admitSymbolSampledSelectionTrajectoryPublication(edit)).toThrow();
});
it('does not invoke accessor replacements for opaque edit ownership', () => {
  const f = fixture(),
    edit = prepare(f),
    get = vi.fn(() => edit.candidate);
  Object.defineProperty(edit, 'candidate', { get, enumerable: true });
  expect(() => admitSymbolSampledSelectionTrajectoryPublication(edit)).toThrow();
  expect(get).not.toHaveBeenCalled();
});

for (const method of ['source', 'sample', 'validateCandidate'] as const)
  it('rejects swallowed public-method reentry ' + method, () => {
    const f = fixture();
    expect(() =>
      prepare(f, () => {
        try {
          if (method === 'source') f.context.source();
          else f.context[method](f.state.definition);
        } catch {}
      }),
    ).toThrow();
  });

for (const kind of [undefined, 'symbol-selection-transform'])
  it('preserves explicit legacy kind default ' + String(kind), () => {
    const validate = vi.fn();
    admitSymbolSampledSelectionPublication({ kind, validate } as never);
    expect(validate).toHaveBeenCalledOnce();
  });
