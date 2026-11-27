import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  symbolLayers,
  validateProject,
  type SymbolDefinition,
  type Vector,
} from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  createSymbolSampledSelectionContext,
  prepareSymbolSampledSelectionTranslation,
  prepareSymbolSampledSelectionScale,
  admitSymbolSampledSelectionPublication,
  type SymbolSampledSelectionState,
} from '../apps/editor/src/symbol-sampled-selection-editor';

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
  createBasicMotionSpan(project, ['@base'], 0, 8, 'linear', { affine: true }, undefined, {
    direction: 'shortest',
    turns: 0,
    rigidGroups: true,
    axisGroupScale: true,
    axisGroupShear: true,
  });
  createBasicMotionSpan(project, ['extra'], 0, 10, 'linear', { affine: true }, undefined, {
    direction: 'shortest',
    turns: 0,
    rigidGroups: true,
    axisGroupScale: true,
    axisGroupShear: true,
  });
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
    createSymbolSampledSelectionContext(
      () => state,
      validateEnclosing,
      validateCandidate,
      (candidate, frame) => ({ candidate, frame }),
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
const requests = [
  { layerId: 'extra', shapeId: 'b' },
  { layerId: '@base', shapeId: 'r' },
];
const offset = { x: 5, y: 4 };

for (const [x, y] of [
  [1.5, 0.75],
  [1.2, 1.2],
  [1, 1.2],
  [1.2, 1],
])
  it(`prepares isolated shared-pivot scaling ${x}/${y} with actual resources and separate drafts`, () => {
    const f = fixture(),
      before = structuredClone(f.state),
      edit = prepareSymbolSampledSelectionScale(f.context, requests, x, y, () => {});
    expect(edit.owner.definitionId).toBe('sprite');
    expect(edit.owner.pivot).toEqual({ x: 62, y: 16 });
    expect(edit.scaling).toEqual({ x, y, pivot: { x: 62, y: 16 } });
    const layers = symbolLayers(edit.candidate),
      selected = [
        [0, 'r', 40],
        [1, 'a', 52],
        [1, 'b', 72],
      ] as const;
    for (const [layer, id, originalX] of selected) {
      const s = layers[layer].keys.find((k) => k.frame === 4)!.shapes.find((s) => s.id === id)!;
      expect(s.x).toBeCloseTo(62 + x * (originalX - 62), 10);
      expect(s.y).toBeCloseTo(16 + y * (10 - 16), 10);
      expect(s.transform).toEqual([x, 0, 0, y]);
    }
    admitSymbolSampledSelectionPublication(edit);
    expect(edit.snapshot).toEqual(before.definition);
    expect(f.state).toEqual(before);
    const moved = prepareSymbolSampledSelectionTranslation(f.context, requests, offset, () => {});
    expect(moved.scaling).toBeUndefined();
    expect(symbolLayers(moved.candidate)[0].keys[4].shapes[0].x).toBe(45);
  });
for (const field of [
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
  it('rejects stale isolated numeric scaling context ' + field, () => {
    const { state, context } = fixture(),
      edit = prepareSymbolSampledSelectionScale(context, requests, 1.5, 0.75, () => {});
    if (field === 'definition' || field === 'symbols' || field === 'assets')
      state[field] = structuredClone(state[field]) as never;
    if (field === 'revision' || field === 'frame' || field === 'policy') state[field]++;
    if (field === 'groups' || field === 'blocked') state[field] = true;
    if (field === 'pick' || field === 'prepared') state[field] = {};
    expect(() => edit.validate()).toThrow(/context changed/);
  });
for (const field of ['definition', 'symbols', 'assets'] as const)
  it('rejects real in-place resource changes ' + field, () => {
    const { state, context } = fixture(),
      edit = prepareSymbolSampledSelectionScale(context, requests, 1.5, 0.75, () => {});
    if (field === 'definition') state.definition.name = 'Changed';
    if (field === 'symbols')
      state.symbols.push({ id: 'new', name: 'New', width: 1, height: 1, shapes: [] });
    if (field === 'assets') state.assets.push({ id: 'new', path: 'assets/new.bin' });
    expect(() => edit.validate()).toThrow(/source changed/);
  });
for (const factor of [
  0,
  1,
  NaN,
  Infinity,
  -Infinity,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  '37',
  new Number(37),
  undefined,
])
  it('rejects raw/noop/overflow isolated factors ' + String(factor), () => {
    const f = fixture(),
      before = structuredClone(f.state);
    expect(() =>
      prepareSymbolSampledSelectionScale(f.context, requests, factor as number, 1, () => {}),
    ).toThrow();
    expect(f.state).toEqual(before);
    admitSymbolSampledSelectionPublication(
      prepareSymbolSampledSelectionScale(f.context, requests, 1.5, 0.75, () => {}),
    );
  });
it('snapshots raw request getters once before private preparation', () => {
  const f = fixture(),
    reads = { layer: 0, shape: 0 };
  prepareSymbolSampledSelectionScale(
    f.context,
    [
      {
        get layerId() {
          reads.layer++;
          return '@base';
        },
        get shapeId() {
          reads.shape++;
          return 'r';
        },
      },
    ],
    1.5,
    0.75,
    () => {},
  );
  expect(reads).toEqual({ layer: 1, shape: 1 });
});
for (const mode of ['input', 'source', 'length'])
  it('rechecks raw original input getter ownership ' + mode, () => {
    const f = fixture(),
      raw = [{ layerId: '@base', shapeId: 'r' }];
    let revision = 0;
    if (mode === 'input')
      Object.defineProperty(raw[0], 'shapeId', {
        get() {
          revision++;
          return 'r';
        },
      });
    if (mode === 'source')
      Object.defineProperty(raw[0], 'shapeId', {
        get() {
          f.state.definition.name = 'Changed';
          return 'r';
        },
      });
    if (mode === 'length')
      Object.defineProperty(raw, 0, {
        get() {
          raw.push({ layerId: '@base', shapeId: 'other' });
          return { layerId: '@base', shapeId: 'r' };
        },
      });
    expect(() =>
      prepareSymbolSampledSelectionScale(f.context, raw, 1.5, 0.75, () => {
        if (revision) throw Error('inputs changed');
      }),
    ).toThrow();
  });
it('retains frozen enclosing and complete candidate admission with source-valid retries', () => {
  const f = fixture(),
    before = structuredClone(f.state),
    edit = prepareSymbolSampledSelectionScale(f.context, requests, 1.5, 0.75, () => {});
  f.rejectEnclosing();
  expect(() => edit.validate()).toThrow(/enclosing changed/);
  f.rejectEnclosing(true);
  f.rejectCandidate();
  expect(() => edit.validate()).toThrow(/candidate rejected/);
  f.rejectCandidate(true);
  admitSymbolSampledSelectionPublication(
    prepareSymbolSampledSelectionScale(f.context, requests, 1.5, 0.75, () => {}),
  );
  expect(f.state).toEqual(before);
});
it('rejects changed-and-restored factor revisions before local publication', () => {
  const f = fixture();
  let revision = 0;
  const prepare = () => {
    const r = revision;
    return prepareSymbolSampledSelectionScale(f.context, requests, 1.5, 0.75, () => {
      if (r !== revision) throw Error('factor changed');
    });
  };
  const first = prepare();
  revision += 2;
  expect(() => first.validate()).toThrow(/factor changed/);
  admitSymbolSampledSelectionPublication(prepare());
});
for (const field of ['candidate', 'owner', 'scaling'])
  it('guards complete detached output and readout metadata ' + field, () => {
    const f = fixture(),
      edit = prepareSymbolSampledSelectionScale(f.context, requests, 1.5, 0.75, () => {});
    if (field === 'candidate') edit.candidate.name = 'Forged';
    if (field === 'owner') edit.owner.pivot.x++;
    if (field === 'scaling') edit.scaling.x++;
    expect(() => edit.validate()).toThrow(/changed/);
  });
for (const change of ['source', 'input', 'candidate', 'scaling'])
  it('rejects late full-candidate admission edits ' + change, () => {
    const f = fixture();
    let armed = false,
      complete = false,
      revision = 0;
    const context = createSymbolSampledSelectionContext(
      () => f.state,
      f.validateEnclosing,
      (candidate) => {
        f.validateCandidate(candidate);
        if (armed) {
          complete = true;
          if (change === 'source') f.state.definition.name = 'Late';
          if (change === 'input') revision++;
          if (change === 'candidate') candidate.name = 'Forged';
          if (change === 'scaling') edit.scaling.pivot.x++;
        }
      },
      () => null,
    )!;
    const edit = prepareSymbolSampledSelectionScale(context, requests, 1.5, 0.75, () => {
      if (revision) throw Error('input changed');
    });
    armed = true;
    expect(() => admitSymbolSampledSelectionPublication(edit)).toThrow();
    expect(complete).toBe(true);
  });
it('rechecks source after complete prepared scaling definition cloning', () => {
  const f = fixture(),
    clone = structuredClone;
  let completed = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const out = clone(value, options),
      d = out as SymbolDefinition;
    if (d?.id === 'sprite' && symbolLayers(d).every((l) => l.motionSpans?.length === 2)) {
      completed = true;
      f.state.definition.name = 'Late';
    }
    return out;
  });
  expect(() =>
    prepareSymbolSampledSelectionScale(f.context, requests, 1.5, 0.75, () => {}),
  ).toThrow(/source changed/);
  expect(completed).toBe(true);
});
for (const phase of ['preparation', 'publication', 'presentation'] as const)
  it('rejects swallowed isolated scaling reentry ' + phase, () => {
    const f = fixture();
    let armed = false,
      attempted = false;
    const reenter = () => {
      if (armed) {
        attempted = true;
        try {
          prepareSymbolSampledSelectionScale(context, requests, 1.5, 0.75, () => {});
        } catch {
          /* hostile callback */
        }
      }
    };
    const context: ReturnType<typeof f.make> = createSymbolSampledSelectionContext(
      () => f.state,
      f.validateEnclosing,
      (candidate) => {
        f.validateCandidate(candidate);
        if (phase !== 'presentation') reenter();
      },
      (candidate, frame) => {
        if (phase === 'presentation') reenter();
        return { candidate, frame };
      },
    )!;
    const edit =
      phase === 'preparation'
        ? null
        : prepareSymbolSampledSelectionScale(context, requests, 1.5, 0.75, () => {});
    armed = true;
    expect(() =>
      phase === 'preparation'
        ? prepareSymbolSampledSelectionScale(context, requests, 1.5, 0.75, () => {})
        : phase === 'publication'
          ? edit!.validate()
          : context.sample(edit!.candidate),
    ).toThrow(/invalidated/);
    expect(attempted).toBe(true);
    armed = false;
    expect(() => context.validate()).toThrow(/invalidated/);
  });
for (const kind of ['enclosing', 'candidate', 'input'])
  it('rejects async isolated scaling admission ' + kind, () => {
    const f = fixture();
    if (kind === 'enclosing')
      expect(() =>
        createSymbolSampledSelectionContext(
          () => f.state,
          async () => {},
          f.validateCandidate,
          () => null,
        ),
      ).toThrow(/synchronous/);
    else {
      const context = createSymbolSampledSelectionContext(
        () => f.state,
        f.validateEnclosing,
        kind === 'candidate' ? async () => {} : f.validateCandidate,
        () => null,
      )!;
      expect(() =>
        prepareSymbolSampledSelectionScale(
          context,
          requests,
          1.5,
          0.75,
          kind === 'input' ? async () => {} : () => {},
        ),
      ).toThrow(/synchronous/);
    }
  });
