import { expect, it } from 'vitest';
import { liveTreeFixture, createLiveMovieTrees } from './live-tree-edit-fixture';
import { symbolInstance } from '../packages/geometry/src/symbols';
import {
  prepareUpdateLiveMotionSpans,
  captureLiveMotionTimeline,
} from '../packages/animation/src/live-motion';
for (const mode of ['zero', 'one', 'clamped'])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`edits ${mode}/${basis} geometry timing independently from independent movie age`, () => {
      const { p, span } = liveTreeFixture(
          mode === 'zero' ? 0 : mode === 'clamped' ? 9998 : 1,
          basis,
        ),
        source = createLiveMovieTrees(p, span),
        before = structuredClone(source);
      const out = prepareUpdateLiveMotionSpans(source, [
          { layerId: 'track', spanId: 'live', changes: { ease: 'in' } },
        ]),
        owner = captureLiveMotionTimeline(() => ({ project: out, revision: 0 })),
        shape = owner.sample(6)[0].key.shapes[0];
      expect(shape.x).toBe(40);
      expect(shape.y).toBe(40);
      expect(shape.rotation).toBeCloseTo(22.5);
      expect(shape.symbolPlayback!.firstFrame).toBe(
        mode === 'zero' ? 0 : mode === 'clamped' ? 9998 : 1,
      );
      expect(out.layers[0].liveMotionSpans).toEqual([{ ...span, ease: 'in' }]);
      expect(out.layers[0].keys).toEqual(before.layers[0].keys);
      expect(out.symbols).toEqual(before.symbols);
      expect(source).toEqual(before);
      owner.dispose();
    });
for (const failure of ['clock', 'button', 'later'])
  it(`requalifies movie ${failure} failures before any detached update returns`, () => {
    const { p, span } = liveTreeFixture(),
      source = createLiveMovieTrees(p, span);
    if (failure === 'clock') source.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
    if (failure === 'button') source.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
    if (failure === 'later') {
      const later = structuredClone(source.layers[0]);
      later.id = 'later';
      later.keys[2].shapes[0].width++;
      source.layers.push(later);
    }
    const before = structuredClone(source),
      requests = [{ layerId: 'track', spanId: 'live', changes: { ease: 'in' as const } }];
    if (failure === 'later') requests.push({ ...requests[0], layerId: 'later' });
    expect(() => prepareUpdateLiveMotionSpans(source, requests)).toThrow();
    expect(source).toEqual(before);
  });

it.each(['movie', 'button'] as const)(
  'admits nested movies but rejects nested buttons on explicit tree updates',
  (kind) => {
    const { p, span } = liveTreeFixture(),
      source = createLiveMovieTrees(p, span),
      leaf = { ...structuredClone(source.symbols![0]), id: 'wrapper' };
    source.symbols!.push(leaf);
    source.symbols![0].shapes = [
      {
        ...symbolInstance(leaf, 0, 0),
        symbolPlayback: { mode: kind === 'movie' ? 'movie' : 'loop', firstFrame: 0 },
      },
    ];
    if (kind === 'button') leaf.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    const before = structuredClone(source);
    const run = () =>
      prepareUpdateLiveMotionSpans(source, [
        { layerId: 'track', spanId: 'live', changes: { ease: 'in' } },
      ]);
    if (kind === 'button') expect(run).toThrow();
    else expect(run().layers[0].liveMotionSpans![0].ease).toBe('in');
    expect(source).toEqual(before);
  },
);

it('does not allow an update to replace the persisted movie marker or authored clock settings', () => {
  const { p, span } = liveTreeFixture(),
    source = createLiveMovieTrees(p, span),
    before = structuredClone(source);
  for (const changes of [
    { symbolContinuity: 'graphics' },
    { symbolPlayback: { mode: 'single', firstFrame: 0 } },
  ])
    expect(() =>
      prepareUpdateLiveMotionSpans(source, [
        { layerId: 'track', spanId: 'live', changes: changes as never },
      ]),
    ).toThrow();
  expect(source).toEqual(before);
});

it('keeps raw original library getters unread during movie updates', () => {
  const { p, span } = liveTreeFixture(),
    source = createLiveMovieTrees(p, span);
  let reads = 0;
  Object.defineProperty(source.symbols![0].shapes[0], 'x', {
    enumerable: true,
    get() {
      reads++;
      return 0;
    },
  });
  expect(() =>
    prepareUpdateLiveMotionSpans(source, [
      { layerId: 'track', spanId: 'live', changes: { ease: 'in' } },
    ]),
  ).toThrow();
  expect(reads).toBe(0);
});
