import { expect, it } from 'vitest';
import { type SymbolDefinition } from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
import { compileSymbolPreviewClockPlan, createSymbolPreviewClock } from '../packages/animation/src/symbol-preview-clock';
import { createMovieTreeRuntime } from '../packages/animation/src/movie-tree-clock';
import { createMovieClock } from '../packages/animation/src/movie-clock';

function fixture() {
  const leaf: SymbolDefinition = {
    id: 'leaf',
    name: 'Leaf',
    width: 80,
    height: 60,
    shapes: [],
    timeline: { duration: 5, keys: [] },
  };
  const child = symbolInstance(leaf, 0, 0);
  child.id = 'child';
  child.symbolPlayback = { mode: 'movie', firstFrame: 2 };
  const graphic: SymbolDefinition = {
    id: 'graphic',
    name: 'Graphic',
    width: 80,
    height: 60,
    shapes: [],
    timeline: {
      duration: 6,
      keys: [
        { frame: 3, shapes: [child] },
        { frame: 5, shapes: [] },
      ],
    },
  };
  const g = symbolInstance(graphic, 0, 0);
  g.id = 'g';
  const parent: SymbolDefinition = {
    id: 'parent',
    name: 'Parent',
    width: 80,
    height: 60,
    shapes: [g],
    timeline: { duration: 6, keys: [] },
  };
  return { parent, symbols: [parent, graphic, leaf] };
}
it('clips selected ranges after resolving graphic ages and resets nested lifetimes at reentry', () => {
  const { parent, symbols } = fixture();
  const clock = createSymbolPreviewClock(parent, symbols, 10, 3, 5);
  const key = 'root/preview/g/child/leaf';
  expect(clock.sample(3, 0, 3)[key]).toBe(0);
  expect(clock.sample(4, 0.1, 4)[key]).toBe(1);
  expect(clock.sample(5, 0.2, 5)[key]).toBeUndefined();
  expect(clock.sample(3, 0.3, 6)[key]).toBe(0);
  expect(clock.sample(4, 30000.1, 300004)[key]).toBe(1);
});
it('starts an edited movie definition at its own playhead instead of treating the preview as a placed movie', () => {
  const { parent, symbols } = fixture();
  parent.defaultPlayback = 'movie';
  const clock = createSymbolPreviewClock(parent, symbols, 10, 0, 5);
  const key = 'root/preview/g/child/leaf';
  expect(clock.sample(3, 0, 3)[key]).toBe(0);
  expect(clock.sample(4, 0.1, 4)[key]).toBe(1);
  expect(clock.sample(5, 0.2, 5)[key]).toBeUndefined();
});
it('keeps movie time running through one-frame loops and starts each session fresh', () => {
  const { parent, symbols } = fixture();
  const clock = createSymbolPreviewClock(parent, symbols, 10, 4, 4);
  const key = 'root/preview/g/child/leaf';
  expect(clock.sample(4, 0, 4)[key]).toBe(0);
  expect(clock.sample(4, 2, 24)[key]).toBe(20);
  expect(createSymbolPreviewClock(parent, symbols, 10, 4, 4).sample(4, 0, 4)[key]).toBe(0);
  expect(() => createSymbolPreviewClock(parent, symbols, 10, 5, 6)).toThrow('range');
});

it('reconstructs fixed-state nested Movie ages after key gaps and loops from the initial pose', () => {
  const { parent, symbols } = fixture();
  parent.shapes[0].symbolPlayback = { mode: 'movie', firstFrame: 2 };
  const budget = { remaining: 200 };
  const plan = compileSymbolPreviewClockPlan(parent, symbols, 10, 0, 0, budget);
  const sequential = createMovieTreeRuntime(plan, createMovieClock);
  const inner = 'root/preview/g/child/leaf';
  const observed: (number | undefined)[] = [];
  for (let age = 0; age < 15; age++) {
    const reconstructed = createMovieTreeRuntime(plan, createMovieClock);
    reconstructed.sample(0, 0, 0);
    const expected = sequential.sample(0, age / 10, 0);
    expect(reconstructed.sample(0, age / 10, 0)).toEqual(expected);
    observed.push(expected[inner]);
  }
  expect(observed.slice(0, 9)).toEqual([undefined, 0, 1, undefined, undefined, undefined, undefined, 0, 1]);
  expect(budget.remaining).toBeLessThan(200);
  expect(() => compileSymbolPreviewClockPlan(parent, symbols, 10, 0, 0, { remaining: 1 })).toThrow('compilation budget');
});

it('button state clocks preserve shared-frame continuity and restart different mapped frames', async () => {
  const { createButtonStateClock } = await import('../packages/animation/src/button-state-clock');
  const { parent, symbols } = fixture();
  parent.buttonStates = { up: 3, over: 3, down: 4, hit: 5 };
  const clock = createButtonStateClock(parent, symbols, 10);
  const key = 'root/preview/g/child/leaf';
  expect(clock.sample(3, 100)[key]).toBe(0);
  expect(clock.sample(3, 102)[key]).toBe(20);
  expect(clock.sample(4, 102)[key]).toBe(0);
  expect(clock.sample(4, 102.5)[key]).toBe(5);
  expect(clock.sample(3, 103)[key]).toBe(0);
  expect(clock.sample(3, 600103)[key]).toBe(6000000);
  expect(() => clock.sample(5, 600104)).toThrow('display frame');
});
