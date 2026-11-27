import { expect, it } from 'vitest';
import { liveCreationIssue } from '../apps/editor/src/live-creation';
import { readOnlyMovieTreeFixture } from './read-only-movie-trees-fixture';
import { symbolInstance } from '../packages/geometry/src/symbols';
for (const first of [0, 1, 9998])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`offers explicit nested ${first}/${basis} without changing the original or other modes`, () => {
      const { p } = readOnlyMovieTreeFixture(basis);
      for (const k of p.layers[0].keys)
        for (const s of k.shapes) s.symbolPlayback!.firstFrame = first;
      const before = structuredClone(p);
      for (const mode of ['plain', 'groups', 'graphics', 'movies'] as const)
        expect(liveCreationIssue(p, 'track', 2, 10, mode)).toBeTruthy();
      expect(liveCreationIssue(p, 'track', 2, 10, 'movie-trees')).toBeUndefined();
      expect(p).toEqual(before);
    });
for (const field of [
  'clock',
  'mode',
  'button',
  'childButton',
  'group',
  'identity',
  'locked',
  'hidden',
  'interior',
  'overlap',
  'missing',
  'cycle',
] as const)
  it(`rejects unsupported nested ${field} endpoints in original hints`, () => {
    const { p } = readOnlyMovieTreeFixture('plain'),
      end = p.layers[0].keys[2].shapes[0];
    if (field === 'clock') end.symbolPlayback!.firstFrame = 9999;
    if (field === 'mode') end.symbolPlayback!.mode = 'loop';
    if (field === 'button' || field === 'childButton')
      p.symbols![field === 'button' ? 0 : 1].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    if (field === 'group') end.groups = ['outer'];
    if (field === 'identity') end.id = 'different';
    if (field === 'locked') p.layers[0].locked = true;
    if (field === 'hidden') p.layers[0].visible = false;
    if (field === 'interior') p.layers[0].keys.splice(2, 0, { frame: 6, shapes: [] });
    if (field === 'overlap')
      p.layers[0].liveMotionSpans = [
        { id: 'tree', start: 2, end: 10, ease: 'linear', symbolContinuity: 'movie-trees' },
      ];
    if (field === 'missing') p.symbols![0].shapes[0].symbolId = 'missing';
    if (field === 'cycle') p.symbols![0].shapes[0].symbolId = 'graphic';
    const before = structuredClone(p);
    expect(liveCreationIssue(p, 'track', 2, 10, 'movie-trees')).toBeTruthy();
    expect(p).toEqual(before);
  });
it.each(['getter', 'inherited'] as const)(
  'rejects original nested library %s before any read',
  (field) => {
    const { p } = readOnlyMovieTreeFixture('plain');
    let reads = 0;
    if (field === 'getter')
      Object.defineProperty(p.symbols![1].timeline, 'duration', {
        enumerable: true,
        get() {
          reads++;
          return 3;
        },
      });
    else
      Object.setPrototypeOf(p.symbols![1].timeline, {
        get secret() {
          reads++;
          return 3;
        },
      });
    expect(liveCreationIssue(p, 'track', 2, 10, 'movie-trees')).toBeTruthy();
    expect(reads).toBe(0);
  },
);
it('offers graphic intermediaries with distinct sibling movie definitions without repairing their clocks', () => {
  const { p } = readOnlyMovieTreeFixture('plain'),
    parent = p.symbols![0],
    leaf = p.symbols![1];
  const bridge = {
    id: 'bridge',
    name: 'Bridge',
    width: 60,
    height: 10,
    shapes: [
      ...parent.shapes,
      {
        ...symbolInstance(leaf, 40, 3),
        id: 'sibling',
        symbolPlayback: { mode: 'movie' as const, firstFrame: 2 },
      },
    ],
  };
  parent.shapes = [
    {
      ...symbolInstance(bridge, 0, 0),
      id: 'graphic',
      symbolPlayback: { mode: 'once', firstFrame: 1 },
    },
  ];
  p.symbols!.push(bridge);
  const before = structuredClone(p);
  expect(liveCreationIssue(p, 'track', 2, 10, 'movie-trees')).toBeUndefined();
  expect(p).toEqual(before);
  expect(liveCreationIssue(p, 'track', 2, 10, 'not-a-mode' as never)).toMatch(/supported/);
});
