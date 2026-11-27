import { it, expect, vi } from 'vitest';
import { createMaskPreviewSession } from '../apps/editor/src/mask-preview-session';
import {
  layerPresentationFixture,
  layerPresentationMaskFixture,
} from './layer-presentation-fixture';
import * as movieModule from '../packages/animation/src/movie-tree-clock';
import * as buttonModule from '../packages/animation/src/button-preview';
import { selectionTrajectoryStamp } from '../packages/animation/src/selection-trajectory';

it('starts at an exact captured frame with a frozen detached pose and source preservation', () => {
  const p = layerPresentationFixture(),
    before = selectionTrajectoryStamp(p),
    session = createMaskPreviewSession(p, 3),
    first = session.current();
  expect(first).toMatchObject({ tick: 0, frame: 3, position: 3, seconds: 0 });
  expect(Object.isFrozen(first.presentation.layers)).toBe(true);
  expect(first.presentation.layers.map((layer) => layer.layerId)).toEqual(['a', 'b', 'hidden']);
  expect(first.presentation.layers[2].shapes).toEqual([]);
  expect(selectionTrajectoryStamp(p)).toBe(before);
  expect(session.current()).toBe(first);
  session.dispose();
});

it('steps independent button-state movies across a held one-frame root without scripts or edits', () => {
  const p = layerPresentationMaskFixture(),
    before = selectionTrajectoryStamp(p),
    session = createMaskPreviewSession(p, 0);
  const poses = [session.current(), session.step(), session.step(), session.step()];
  expect(poses.map((p) => [p.tick, p.frame, p.seconds, p.position])).toEqual([
    [0, 0, 0, 0],
    [1, 0, 0.5, 1],
    [2, 0, 1, 2],
    [3, 0, 1.5, 3],
  ]);
  expect(poses.map((p) => p.presentation.layers[1].shapes.map((s) => s.x))).toEqual([
    [0],
    [20],
    [],
    [0],
  ]);
  expect(poses.map((p) => p.presentation.buttons.map((b) => b.token))).toEqual(
    Array(4).fill(poses[0].presentation.buttons.map((b) => b.token)),
  );
  expect(selectionTrajectoryStamp(p)).toBe(before);
  session.dispose();
});

it('starts and loops graphic ages at the captured root position while time remains monotonic', () => {
  const p = layerPresentationFixture(),
    session = createMaskPreviewSession(p, 6);
  const poses = [session.current(), session.step(), session.step(), session.step()];
  expect(poses.map((p) => [p.frame, p.position, p.seconds])).toEqual([
    [6, 6, 0],
    [7, 7, 0.5],
    [0, 8, 1],
    [1, 9, 1.5],
  ]);
  expect(
    poses.map((p) => p.presentation.layers[0].shapes.some((s) => s.id.startsWith('same/child'))),
  ).toEqual([true, true, true, true]);
  session.dispose();
});

it('observes sibling disappearance/reentry without pruning still-visible button clocks', () => {
  const p = layerPresentationFixture(),
    session = createMaskPreviewSession(p, 0),
    poses = [session.current()];
  for (let tick = 1; tick <= 10; tick++) poses.push(session.step());
  expect(poses[2].presentation.buttons.filter((b) => b.shape.id === 'same/child')).toHaveLength(0);
  expect(poses[3].presentation.buttons.some((b) => b.shape.id === 'same/child')).toBe(true);
  expect(poses[5].presentation.layers[0].shapes).toEqual([]);
  expect(poses[6].presentation.buttons.some((b) => b.layerId === 'a')).toBe(true);
  expect(poses[6].presentation.buttons.find((b) => b.layerId === 'a')!.token).not.toBe(
    poses[0].presentation.buttons.find((b) => b.layerId === 'a')!.token,
  );
  expect(poses[7].presentation.buttons.some((b) => b.layerId === 'a')).toBe(true);
  expect(
    poses[7].presentation.buttons.find((b) => b.layerId === 'b' && b.shape.id === 'same/child')!
      .token,
  ).not.toBe(
    poses[0].presentation.buttons.find((b) => b.layerId === 'b' && b.shape.id === 'same/child')!
      .token,
  );
  session.dispose();
});

it('reuses same-time retries and resets only on explicit Restart', () => {
  const session = createMaskPreviewSession(layerPresentationMaskFixture(), 0),
    first = session.current(),
    second = session.step();
  for (let n = 0; n < 5; n++) expect(session.current()).toBe(second);
  const restart = session.restart();
  expect(restart).toEqual(first);
  expect(restart).not.toBe(first);
  expect(session.step()).toEqual(second);
  session.dispose();
});

it('samples a root clock and complete state prune once per tick, including opacity-only paint resolution', () => {
  const p = layerPresentationMaskFixture();
  p.opacityBindings = [
    { layerId: 'mask', shapeId: 'button', start: 0, end: 0, keys: [{ frame: 0, opacity: 0.25 }] },
  ];
  const makeMovie = movieModule.createMovieTreeClock,
    makeButtons = buttonModule.createRootButtonMoviePlayback;
  const movieSamples: number[] = [],
    prunes: number[] = [],
    parents: number[] = [];
  const movie = vi.spyOn(movieModule, 'createMovieTreeClock').mockImplementation(() => {
    const clock = makeMovie(),
      sample = clock.sample;
    clock.sample = (...args) => {
      movieSamples.push(args[2]);
      return sample(...args);
    };
    return clock;
  });
  const buttons = vi.spyOn(buttonModule, 'createRootButtonMoviePlayback').mockImplementation(() => {
    const clock = makeButtons(),
      sample = clock.sample;
    clock.sample = (...args) => {
      (args[5] === false ? parents : prunes).push(args[4]);
      return sample(...args);
    };
    return clock;
  });
  try {
    const session = createMaskPreviewSession(p, 0);
    const a = session.current();
    expect(a.presentation.layers[1].shapes[0].opacity).toBe(0.25);
    session.current();
    session.current();
    const b = session.step();
    session.current();
    expect(movieSamples).toEqual([0, 0.5]);
    expect(prunes).toEqual([0, 0.5]);
    expect(parents).toEqual([0, 0.5]);
    expect(b.presentation.layers[1].shapes[0].x).toBe(20);
    session.dispose();
  } finally {
    movie.mockRestore();
    buttons.mockRestore();
  }
});

for (const frame of [-1, 0.5, 8, NaN, Infinity])
  it(`rejects raw starting frame ${frame} without a session`, () => {
    expect(() => createMaskPreviewSession(layerPresentationFixture(), frame)).toThrow('exact');
  });
it('rejects original nonfinite/getter data before it can be normalized', () => {
  const p = layerPresentationFixture();
  p.layers[0].keys[0].shapes[0].x = NaN;
  expect(() => createMaskPreviewSession(p, 0)).toThrow('nonfinite');
  let reads = 0;
  Object.defineProperty(p.layers[0].keys[0].shapes[0], 'x', {
    get() {
      reads++;
      return 0;
    },
    enumerable: true,
  });
  expect(() => createMaskPreviewSession(p, 0)).toThrow('data fields');
  expect(reads).toBe(0);
});

it('rejects stale source and disposed sessions without returning a cached pose', () => {
  const p = layerPresentationMaskFixture(),
    session = createMaskPreviewSession(p, 0);
  session.current();
  p.background = '#123456';
  expect(() => session.current()).toThrow('source changed');
  expect(() => session.step()).toThrow('Restart');
  expect(() => session.restart()).toThrow('source changed');
  session.dispose();
  expect(() => session.current()).toThrow('closed');
  expect(() => session.restart()).toThrow('closed');
  session.dispose();
});

it('requires Restart after synchronous validation failure, preserving the last successful public pose', () => {
  let reject = false;
  const session = createMaskPreviewSession(layerPresentationMaskFixture(), 0, {
      validate: () => {
        if (reject) throw Error('Context changed');
      },
    }),
    first = session.current();
  reject = true;
  expect(() => session.step()).toThrow('Context changed');
  expect(first.tick).toBe(0);
  reject = false;
  expect(() => session.current()).toThrow('Restart');
  expect(session.restart()).toEqual(first);
  session.dispose();
});

it('rejects swallowed session reentry and permits explicit fresh Restart', () => {
  let hook = false;
  const session = createMaskPreviewSession(layerPresentationMaskFixture(), 0, {
    validate: () => {
      if (hook) {
        hook = false;
        try {
          session.step();
        } catch {
          /* Outer cached reads must reject too. */
        }
      }
    },
  });
  session.current();
  hook = true;
  expect(() => session.current()).toThrow('reentered');
  expect(() => session.current()).toThrow('Restart');
  expect(session.restart().tick).toBe(0);
  session.dispose();
});

it('captures its validation callback once and rejects asynchronous admission', () => {
  let reads = 0,
    calls = 0;
  const options = {
    get validate() {
      reads++;
      return () => {
        calls++;
      };
    },
  };
  const session = createMaskPreviewSession(layerPresentationMaskFixture(), 0, options);
  session.current();
  session.step();
  expect(reads).toBe(1);
  expect(calls).toBeGreaterThan(3);
  session.dispose();
  expect(() =>
    createMaskPreviewSession(layerPresentationMaskFixture(), 0, {
      validate: (() => Promise.reject(Error('async'))) as () => void,
    }),
  ).toThrow('synchronous');
});

for (const fps of [3, 7, 24, 29, 60])
  it(`uses tick/fps time with exact visible movie reentry at ${fps} fps`, () => {
    const p = layerPresentationMaskFixture();
    p.fps = fps;
    p.duration = 6;
    const layer = p.layers[1];
    layer.keys.push(
      { frame: 1, shapes: [] },
      { frame: 3, shapes: structuredClone(layer.keys[0].shapes) },
    );
    const session = createMaskPreviewSession(p, 0);
    for (let tick = 0; tick < 24; tick++) {
      const result = tick ? session.step() : session.current();
      expect(result.seconds).toBe(tick / fps);
      const frame = tick % 6;
      expect(result.presentation.layers[1].shapes.map((s) => s.x)).toEqual(
        frame === 0 || frame === 3 ? [0] : frame === 4 ? [20] : [],
      );
    }
    session.dispose();
  });

for (const change of ['context', 'output', 'dispose'])
  it(`rejects late ${change} after clock sampling without changing earlier poses`, () => {
    let reject = false;
    const session = createMaskPreviewSession(layerPresentationMaskFixture(), 0, {
        validate: () => {
          if (reject) throw Error('Late context');
        },
      }),
      first = session.current(),
      native = structuredClone;
    let hit = false;
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, ...args) => {
      const result = native(value, ...args);
      if (!hit && value && typeof value === 'object' && 'layers' in value && 'signature' in value) {
        hit = true;
        if (change === 'context') reject = true;
        if (change === 'output')
          (result as { layers: { shapes: { x: number }[] }[] }).layers[0].shapes[0].x = 500;
        if (change === 'dispose') session.dispose();
      }
      return result;
    });
    try {
      expect(() => session.step()).toThrow();
      expect(hit).toBe(true);
    } finally {
      clone.mockRestore();
      reject = false;
    }
    expect(first.tick).toBe(0);
    expect(first.presentation.layers[1].shapes[0].x).toBe(0);
    if (change === 'dispose') expect(() => session.current()).toThrow('closed');
    else {
      expect(() => session.current()).toThrow('Restart');
      expect(session.restart()).toEqual(first);
    }
    session.dispose();
  });
