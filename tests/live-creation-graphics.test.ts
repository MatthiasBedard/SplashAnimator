import { expect, it } from 'vitest';
import { liveGraphicFixture } from './live-graphics-fixture';
import { liveCreationIssue } from '../apps/editor/src/live-creation';
for (const mode of ['default', 'loop', 'once', 'single'])
  for (const basis of ['plain', 'affine', 'reflected'])
    it(`offers explicit ${mode}/${basis} graphics without changing default hints or source`, () => {
      const { p } = liveGraphicFixture(mode, basis),
        before = structuredClone(p);
      expect(liveCreationIssue(p, 'track', 2, 10)).toMatch(/Symbol/);
      expect(liveCreationIssue(p, 'track', 2, 10, 'groups')).toMatch(/Symbol/);
      expect(liveCreationIssue(p, 'track', 2, 10, 'graphics')).toBeUndefined();
      expect(p).toEqual(before);
    });
for (const field of [
  'clock',
  'movie',
  'button',
  'group',
  'identity',
  'locked',
  'hidden',
  'interior',
  'overlap',
])
  it(`does not offer unsafe graphic ${field} endpoints`, () => {
    const { p, span } = liveGraphicFixture(),
      last = p.layers[0].keys[2].shapes[0];
    if (field === 'clock') last.symbolPlayback!.firstFrame = 2;
    if (field === 'movie') last.symbolPlayback!.mode = 'movie';
    if (field === 'button') p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
    if (field === 'group') last.groups = ['outer'];
    if (field === 'identity') last.id = 'different';
    if (field === 'locked') p.layers[0].locked = true;
    if (field === 'hidden') p.layers[0].visible = false;
    if (field === 'interior') p.layers[0].keys.splice(2, 0, { frame: 6, shapes: [] });
    if (field === 'overlap') p.layers[0].liveMotionSpans = [span];
    const before = structuredClone(p);
    expect(liveCreationIssue(p, 'track', 2, 10, 'graphics')).toBeTruthy();
    expect(p).toEqual(before);
  });
it('rejects original library accessors and prototypes before hint reads', () => {
  const { p } = liveGraphicFixture();
  let reads = 0;
  Object.defineProperty(p.symbols![0].timeline, 'duration', {
    enumerable: true,
    get() {
      reads++;
      return 5;
    },
  });
  expect(liveCreationIssue(p, 'track', 2, 10, 'graphics')).toMatch(/accessors/);
  expect(reads).toBe(0);
});

it('rejects inherited graphic library durations without reading them', () => {
  const { p } = liveGraphicFixture();
  let reads = 0;
  delete (p.symbols![0].timeline as { duration?: number }).duration;
  Object.setPrototypeOf(p.symbols![0].timeline, {
    get duration() {
      reads++;
      return 5;
    },
  });
  expect(liveCreationIssue(p, 'track', 2, 10, 'graphics')).toMatch(/original plain/);
  expect(reads).toBe(0);
});
