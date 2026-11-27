import { afterEach, expect, it, vi } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  createSampledSelectionContext,
  prepareSampledSelectionTranslation,
  prepareSampledSelectionRotation,
  admitSampledSelectionPublication,
  type SampledSelectionState,
} from '../apps/editor/src/sampled-selection-editor';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const project = newProject();
  project.duration = 12;
  const layer = project.layers[0];
  layer.id = 'base';
  const shape = (id: string, x: number): Vector => ({
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
  });
  layer.keys = [
    { frame: 0, shapes: [shape('r', 0), shape('b', 20)] },
    { frame: 8, shapes: [shape('r', 80), shape('b', 100)] },
    { frame: 10, shapes: [] },
  ];
  createBasicMotionSpan(project, ['base'], 0, 8, 'linear');
  const state: SampledSelectionState = {
    project,
    signature: JSON.stringify(project),
    frame: 4,
    revision: 1,
    policy: 0,
    groups: false,
    pick: null,
    children: false,
    prepared: null,
    stamp: 'source',
    blocked: false,
  };
  const context = createSampledSelectionContext(
    () => state,
    (source) => structuredClone(source),
    () => ({ scene: [], rendered: [] }),
  )!;
  return { state, context };
}
const requests = [
  { layerId: 'base', shapeId: 'b' },
  { layerId: 'base', shapeId: 'r' },
];

it('prepares one original union rotation with independent point math and separate translation drafts', () => {
  const { state, context } = fixture(),
    before = structuredClone(state.project),
    edit = prepareSampledSelectionRotation(context, requests, 90, () => {});
  expect(edit.owner.pivot).toEqual({ x: 56, y: 16 });
  expect(edit.rotation).toEqual({ degrees: 90, pivot: { x: 56, y: 16 } });
  expect(edit.candidate.layers[0].keys[4].shapes.map((s) => [s.x, s.y, s.rotation])).toEqual([
    [62, 0, 90],
    [62, 20, 90],
  ]);
  admitSampledSelectionPublication(edit);
  expect(state.project).toEqual(before);
  expect(edit.snapshot).toEqual(before);
  const translated = prepareSampledSelectionTranslation(
    context,
    requests,
    { x: 5, y: 4 },
    () => {},
  );
  expect(translated.rotation).toBeUndefined();
  expect(translated.candidate.layers[0].keys[4].shapes[0].x).toBe(45);
});
for (const field of [
  'project',
  'frame',
  'revision',
  'policy',
  'groups',
  'pick',
  'children',
  'prepared',
  'signature',
  'blocked',
] as const)
  it('rejects stale numeric rotation context ' + field, () => {
    const { state, context } = fixture(),
      edit = prepareSampledSelectionRotation(context, requests, 37, () => {});
    if (field === 'project') state.project = structuredClone(state.project);
    if (field === 'frame' || field === 'revision' || field === 'policy') state[field]++;
    if (field === 'groups' || field === 'children' || field === 'blocked') state[field] = true;
    if (field === 'pick' || field === 'prepared') state[field] = {};
    if (field === 'signature') state.signature = 'changed';
    expect(() => admitSampledSelectionPublication(edit)).toThrow();
  });
for (const angle of [
  0,
  360,
  -720,
  NaN,
  Infinity,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  '37',
  new Number(37),
  undefined,
])
  it('rejects raw/noop/overflow degree inputs ' + String(angle), () => {
    const { state, context } = fixture(),
      before = structuredClone(state.project);
    expect(() =>
      prepareSampledSelectionRotation(context, requests, angle as number, () => {}),
    ).toThrow();
    expect(state.project).toEqual(before);
    admitSampledSelectionPublication(
      prepareSampledSelectionRotation(context, requests, 37, () => {}),
    );
  });
it('reads raw original request identities once', () => {
  const { context } = fixture();
  const reads = { layer: 0, shape: 0 };
  prepareSampledSelectionRotation(
    context,
    [
      {
        get layerId() {
          reads.layer++;
          return 'base';
        },
        get shapeId() {
          reads.shape++;
          return 'r';
        },
      },
    ],
    37,
    () => {},
  );
  expect(reads).toEqual({ layer: 1, shape: 1 });
});
for (const field of ['angle', 'source', 'mode'])
  it('rejects real late changes after complete rotated candidate reads ' + field, () => {
    const { state, context } = fixture();
    let revision = 0,
      complete = false;
    const edit = prepareSampledSelectionRotation(context, requests, 37, () => {
        if (revision) throw Error('rotation input changed');
      }),
      stringify = JSON.stringify;
    vi.spyOn(JSON, 'stringify').mockImplementation(((
      value: unknown,
      replacer?: unknown,
      space?: string | number,
    ) => {
      const out = stringify(value, replacer as never, space);
      if (value === edit.candidate) {
        complete = true;
        if (field === 'source') state.project.layers[0].keys[0].shapes[0].fill = '#00ff00';
        else if (field === 'mode') state.policy += 2;
        else revision += 2;
      }
      return out;
    }) as typeof JSON.stringify);
    expect(() => admitSampledSelectionPublication(edit)).toThrow();
    expect(complete).toBe(true);
    expect(state.project.layers[0].motionSpans).toHaveLength(1);
  });
it('rejects changed-and-restored angle revisions and prepares a fresh source-valid retry', () => {
  const { context } = fixture();
  let revision = 0;
  const prepare = () => {
    const captured = revision;
    return prepareSampledSelectionRotation(context, requests, 37, () => {
      if (captured !== revision) throw Error('angle changed');
    });
  };
  const first = prepare();
  revision += 2;
  expect(() => admitSampledSelectionPublication(first)).toThrow(/angle changed/);
  admitSampledSelectionPublication(prepare());
});
for (const mode of ['identity', 'length', 'source'])
  it('rejects request getters changing ownership ' + mode, () => {
    const { state, context } = fixture(),
      raw = [{ layerId: 'base', shapeId: 'r' }];
    let revision = 0;
    if (mode === 'identity')
      Object.defineProperty(raw[0], 'shapeId', {
        get() {
          revision++;
          return 'r';
        },
      });
    if (mode === 'source')
      Object.defineProperty(raw[0], 'shapeId', {
        get() {
          state.project.layers[0].keys[0].shapes[0].x++;
          return 'r';
        },
      });
    if (mode === 'length')
      Object.defineProperty(raw, 0, {
        get() {
          raw.push({ layerId: 'base', shapeId: 'b' });
          return { layerId: 'base', shapeId: 'r' };
        },
      });
    expect(() =>
      prepareSampledSelectionRotation(context, raw, 37, () => {
        if (revision) throw Error('input changed');
      }),
    ).toThrow();
  });
it('rechecks inputs after a sampling callback before publication', () => {
  const { context } = fixture();
  let revision = 0;
  const edit = prepareSampledSelectionRotation(context, requests, 37, () => {
    if (revision) throw Error('late sample');
  });
  const sample: typeof context = {
    ...context,
    sample() {
      revision++;
      return { scene: [], rendered: [] };
    },
  };
  sample.sample(edit.candidate);
  expect(() => admitSampledSelectionPublication(edit)).toThrow(/late sample/);
});
