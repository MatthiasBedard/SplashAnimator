import { afterEach, expect, it, vi } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  createSampledSelectionContext,
  prepareSampledSelectionTranslation,
  prepareSampledSelectionRotation,
  prepareSampledSelectionScale,
  prepareSampledSelectionSkew,
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
  createBasicMotionSpan(project, ['base'], 0, 8, 'linear', { affine: true });
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

for (const [axis, degrees] of [
  ['x', 35],
  ['y', -25],
  ['x', -18],
  ['y', 30],
] as const)
  it(`prepares independent numeric skew ${axis}/${degrees} from original membership`, () => {
    const { state, context } = fixture(),
      before = structuredClone(state.project),
      edit = prepareSampledSelectionSkew(context, requests, axis, degrees, () => {}),
      k = Math.tan((degrees * Math.PI) / 180);
    expect(edit.owner.pivot).toEqual({ x: 56, y: 16 });
    expect(edit.shearing).toEqual({ axis, degrees, pivot: { x: 56, y: 16 } });
    expect(edit.rotation).toBeUndefined();
    expect(edit.scaling).toBeUndefined();
    for (const [i, v] of edit.candidate.layers[0].keys[4].shapes.entries()) {
      expect(v.x).toBeCloseTo(40 + i * 20 + (axis === 'x' ? k * (10 - 16) : 0), 10);
      expect(v.y).toBeCloseTo(10 + (axis === 'y' ? k * (40 + i * 20 - 56) : 0), 10);
      expect(v.transform).toEqual(axis === 'x' ? [1, 0, k, 1] : [1, k, 0, 1]);
    }
    admitSampledSelectionPublication(edit);
    expect(edit.snapshot).toEqual(before);
    expect(state.project).toEqual(before);
    expect(
      prepareSampledSelectionTranslation(context, requests, { x: 5, y: 4 }, () => {}).shearing,
    ).toBeUndefined();
    expect(
      prepareSampledSelectionRotation(context, requests, 90, () => {}).shearing,
    ).toBeUndefined();
    expect(
      prepareSampledSelectionScale(context, requests, 1.2, 1.2, () => {}).shearing,
    ).toBeUndefined();
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
  it('rejects stale numeric shearing context ' + field, () => {
    const { state, context } = fixture(),
      edit = prepareSampledSelectionSkew(context, requests, 'x', 35, () => {});
    if (field === 'project') state.project = structuredClone(state.project);
    if (field === 'frame' || field === 'revision' || field === 'policy') state[field]++;
    if (field === 'groups' || field === 'children' || field === 'blocked') state[field] = true;
    if (field === 'pick' || field === 'prepared') state[field] = {};
    if (field === 'signature') state.signature = 'changed';
    expect(() => admitSampledSelectionPublication(edit)).toThrow();
  });

for (const [axis, degrees] of [
  ['z', 35],
  [undefined, 35],
  [new String('x'), 35],
  ['x', 0],
  ['x', 180],
  ['y', 90],
  ['x', NaN],
  ['y', Infinity],
  ['x', Number.MIN_VALUE],
  ['x', Number.MAX_VALUE],
  ['x', '35'],
  ['x', new Number(35)],
  ['x', undefined],
])
  it('rejects raw/noop/overflow numeric skew ' + String(axis) + '/' + String(degrees), () => {
    const { state, context } = fixture(),
      before = structuredClone(state.project);
    expect(() =>
      prepareSampledSelectionSkew(context, requests, axis as 'x', degrees as number, () => {}),
    ).toThrow();
    expect(state.project).toEqual(before);
    admitSampledSelectionPublication(
      prepareSampledSelectionSkew(context, requests, 'x', 35, () => {}),
    );
  });

it('reads original raw request identities once', () => {
  const { context } = fixture();
  let layer = 0,
    shape = 0;
  prepareSampledSelectionSkew(
    context,
    [
      {
        get layerId() {
          layer++;
          return 'base';
        },
        get shapeId() {
          shape++;
          return 'r';
        },
      },
    ],
    'x',
    35,
    () => {},
  );
  expect([layer, shape]).toEqual([1, 1]);
});

for (const field of ['skew inputs', 'source', 'mode'])
  it('rejects late changes after complete sheared candidate serialization: ' + field, () => {
    const { state, context } = fixture();
    let revision = 0,
      complete = false;
    const edit = prepareSampledSelectionSkew(context, requests, 'x', 35, () => {
        if (revision) throw Error('scale input changed');
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

it('rejects changed-and-restored skew input revisions and allows a fresh retry', () => {
  const { context } = fixture();
  let revision = 0;
  const prepare = () => {
    const captured = revision;
    return prepareSampledSelectionSkew(context, requests, 'x', 35, () => {
      if (captured !== revision) throw Error('skew input changed');
    });
  };
  const first = prepare();
  revision += 2;
  expect(() => admitSampledSelectionPublication(first)).toThrow(/skew input changed/);
  admitSampledSelectionPublication(prepare());
});

for (const kind of ['identity', 'length', 'source'])
  it('rejects request getters changing shearing ownership: ' + kind, () => {
    const { state, context } = fixture(),
      raw = [{ layerId: 'base', shapeId: 'r' }];
    let revision = 0;
    if (kind === 'identity')
      Object.defineProperty(raw[0], 'shapeId', {
        get() {
          revision++;
          return 'r';
        },
      });
    if (kind === 'source')
      Object.defineProperty(raw[0], 'shapeId', {
        get() {
          state.project.layers[0].keys[0].shapes[0].x++;
          return 'r';
        },
      });
    if (kind === 'length')
      Object.defineProperty(raw, 0, {
        get() {
          raw.push({ layerId: 'base', shapeId: 'b' });
          return { layerId: 'base', shapeId: 'r' };
        },
      });
    expect(() =>
      prepareSampledSelectionSkew(context, raw, 'x', 35, () => {
        if (revision) throw Error('input changed');
      }),
    ).toThrow();
  });

it('rechecks skew input ownership after the prepared-child sampler returns', () => {
  const { context } = fixture();
  let revision = 0;
  const edit = prepareSampledSelectionSkew(context, requests, 'x', 35, () => {
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
