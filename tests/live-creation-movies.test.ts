import { expect, it } from 'vitest';
import { liveMovieFixture } from './live-movies-fixture';
import { liveCreationIssue } from '../apps/editor/src/live-creation';
import { symbolInstance } from '../packages/geometry/src/symbols';
for (const first of [0, 1, 9998])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`offers explicit movie${first}/${basis} without broadening existing modes or changing source`, () => {
      const { p } = liveMovieFixture(first, basis),
        before = structuredClone(p);
      for (const mode of ['plain', 'groups', 'graphics'] as const)
        expect(liveCreationIssue(p, 'track', 2, 10, mode)).toBeTruthy();
      expect(liveCreationIssue(p, 'track', 2, 10, 'movies')).toBeUndefined();
      expect(p).toEqual(before);
    });
for (const field of [
  'clock',
  'graphic',
  'button',
  'nestedMovie',
  'nestedButton',
  'group',
  'identity',
  'locked',
  'hidden',
  'interior',
  'overlap',
])
  it(`does not offer unsafe movie ${field} endpoints`, () => {
    const { p, span, definition } = liveMovieFixture(),
      end = p.layers[0].keys[2].shapes[0];
    if (field === 'clock') end.symbolPlayback!.firstFrame = 2;
    if (field === 'graphic') end.symbolPlayback!.mode = 'loop';
    if (field === 'button') definition.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    if (field === 'nestedMovie' || field === 'nestedButton') {
      const leaf = { ...structuredClone(definition), id: 'leaf' };
      p.symbols!.push(leaf);
      definition.shapes = [
        {
          ...symbolInstance(leaf, 0, 0),
          symbolPlayback: { mode: field === 'nestedMovie' ? 'movie' : 'loop', firstFrame: 0 },
        },
      ];
      if (field === 'nestedButton') leaf.buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
    }
    if (field === 'group') end.groups = ['outer'];
    if (field === 'identity') end.id = 'different';
    if (field === 'locked') p.layers[0].locked = true;
    if (field === 'hidden') p.layers[0].visible = false;
    if (field === 'interior') p.layers[0].keys.splice(2, 0, { frame: 6, shapes: [] });
    if (field === 'overlap') p.layers[0].liveMotionSpans = [span];
    const before = structuredClone(p);
    expect(liveCreationIssue(p, 'track', 2, 10, 'movies')).toBeTruthy();
    expect(p).toEqual(before);
  });
it.each(['getter', 'inherited'] as const)(
  'rejects raw movie library %s before hint reads',
  (field) => {
    const { p } = liveMovieFixture();
    let reads = 0;
    if (field === 'getter')
      Object.defineProperty(p.symbols![0].timeline, 'duration', {
        enumerable: true,
        get() {
          reads++;
          return 5;
        },
      });
    else {
      delete (p.symbols![0].timeline as { duration?: number }).duration;
      Object.setPrototypeOf(p.symbols![0].timeline, {
        get duration() {
          reads++;
          return 5;
        },
      });
    }
    expect(liveCreationIssue(p, 'track', 2, 10, 'movies')).toBeTruthy();
    expect(reads).toBe(0);
  },
);
