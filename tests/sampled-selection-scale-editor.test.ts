import { afterEach, expect, it, vi } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import {
  createSampledSelectionContext,
  prepareSampledSelectionTranslation,
  prepareSampledSelectionRotation,
  prepareSampledSelectionScale,
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

for (const [x, y] of [
  [1.5, 0.75],
  [1.2, 1.2],
  [1, 1.2],
  [1.2, 1],
])
  it(`prepares original shared-pivot numeric scaling ${x}/${y} independently of other drafts`, () => {
    const { state, context } = fixture(),
      before = structuredClone(state.project),
      edit = prepareSampledSelectionScale(context, requests, x, y, () => {});
    expect(edit.owner.pivot).toEqual({ x: 56, y: 16 });
    expect(edit.scaling).toEqual({ x, y, pivot: { x: 56, y: 16 } });
    expect(edit.rotation).toBeUndefined();
    for (const [i, s] of edit.candidate.layers[0].keys[4].shapes.entries()) {
      expect(s.x).toBeCloseTo(56 + x * (40 + i * 20 - 56), 10);
      expect(s.y).toBeCloseTo(16 + y * (10 - 16), 10);
      expect(s.transform).toEqual([x, 0, 0, y]);
    }
    admitSampledSelectionPublication(edit);
    expect(edit.snapshot).toEqual(before);
    expect(state.project).toEqual(before);
    const translation = prepareSampledSelectionTranslation(
        context,
        requests,
        { x: 5, y: 4 },
        () => {},
      ),
      rotation = prepareSampledSelectionRotation(context, requests, 90, () => {});
    expect(translation.scaling).toBeUndefined();
    expect(rotation.scaling).toBeUndefined();
    expect(translation.candidate.layers[0].keys[4].shapes[0].x).toBe(45);
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
  it('rejects stale numeric scaling context ' + field, () => {
    const { state, context } = fixture(),
      edit = prepareSampledSelectionScale(context, requests, 1.5, 0.75, () => {});
    if (field === 'project') state.project = structuredClone(state.project);
    if (field === 'frame' || field === 'revision' || field === 'policy') state[field]++;
    if (field === 'groups' || field === 'children' || field === 'blocked') state[field] = true;
    if (field === 'pick' || field === 'prepared') state[field] = {};
    if (field === 'signature') state.signature = 'changed';
    expect(() => admitSampledSelectionPublication(edit)).toThrow();
  });

for (const [x, y] of [
  [0, 1],
  [1, 0],
  [1, 1],
  [NaN, 1],
  [1, Infinity],
  [Number.MIN_VALUE, 1],
  [Number.MAX_VALUE, 1],
  ['2', 1],
  [new Number(2), 1],
  [undefined, 1],
])
  it(`rejects raw/noop/overflow numeric scaling ${String(x)}/${String(y)}`, () => {
    const { state, context } = fixture(),
      before = structuredClone(state.project);
    expect(() =>
      prepareSampledSelectionScale(context, requests, x as number, y as number, () => {}),
    ).toThrow();
    expect(state.project).toEqual(before);
    admitSampledSelectionPublication(
      prepareSampledSelectionScale(context, requests, 1.5, 0.75, () => {}),
    );
  });

it('reads original raw request identities once', () => {
  const { context } = fixture();
  let layer = 0,
    shape = 0;
  prepareSampledSelectionScale(
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
    1.5,
    0.75,
    () => {},
  );
  expect([layer, shape]).toEqual([1, 1]);
});

for (const field of ['factors', 'source', 'mode'])
  it('rejects late changes after complete scaled candidate serialization: ' + field, () => {
    const { state, context } = fixture();
    let revision = 0,
      complete = false;
    const edit = prepareSampledSelectionScale(context, requests, 1.5, 0.75, () => {
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

it('rejects changed-and-restored factor revisions and allows a fresh retry', () => {
  const { context } = fixture();
  let revision = 0;
  const prepare = () => {
    const captured = revision;
    return prepareSampledSelectionScale(context, requests, 1.5, 0.75, () => {
      if (captured !== revision) throw Error('factor changed');
    });
  };
  const first = prepare();
  revision += 2;
  expect(() => admitSampledSelectionPublication(first)).toThrow(/factor changed/);
  admitSampledSelectionPublication(prepare());
});

for (const kind of ['identity', 'length', 'source'])
  it('rejects request getters changing scaling ownership: ' + kind, () => {
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
      prepareSampledSelectionScale(context, raw, 1.5, 0.75, () => {
        if (revision) throw Error('input changed');
      }),
    ).toThrow();
  });

it('rechecks factor ownership after the prepared-child sampler returns', () => {
  const { context } = fixture();
  let revision = 0;
  const edit = prepareSampledSelectionScale(context, requests, 1.5, 0.75, () => {
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
