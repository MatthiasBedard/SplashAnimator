import { expect, it, vi } from 'vitest';
import { validateProject } from '../packages/document/src';
import {
  capturePresentationBank,
  detachLayerPresentation,
} from '../packages/animation/src/layer-presentation';
import {
  layerPresentationFixture,
  createInteractiveButtonView,
  createMovieTreeClock,
  createRootButtonMoviePlayback,
  evaluate,
  createStageOpacityView,
  rect,
} from './layer-presentation-fixture';

function host(p = layerPresentationFixture(), opt = true) {
  validateProject(p);
  const view = createInteractiveButtonView(p, { layerPresentation: opt }),
    movies = createMovieTreeClock(),
    states = createRootButtonMoviePlayback();
  let count = 0;
  return {
    p,
    view,
    movies,
    states,
    get count() {
      return count;
    },
    sample(
      frame: number,
      time: number,
      over: string | null = null,
      down: string | null = null,
      position = frame,
    ) {
      const frames = movies.sample(p, frame, time, position),
        origins = movies.origins();
      const snapshot = view.sample(frame, frames, origins, over, down, (button) => {
        count++;
        const state = states.sample(p, [button], over, down, time, false);
        return {
          frames: state.stateFrames.get(button.token)!,
          origins: state.stateOrigins.get(button.token)!,
        };
      });
      const bank = states.sample(p, snapshot.buttons, over, down, time);
      return { snapshot, bank, frames, origins };
    },
  };
}
for (const step of [0, 1, 2, 3, 4, 5, 6, 7])
  it(`preserves original layer boundaries, poses and final visible buttons at frame ${step}`, () => {
    const h = host(),
      before = structuredClone(h.p);
    h.sample(0, 0);
    const { snapshot, bank, frames } = h.sample(step, step / 2),
      calls = h.count;
    const legacy = evaluate(
      snapshot.render(null, null, bank.artwork, bank.stateFrames),
      step,
      frames,
    );
    const data = snapshot.presentation(bank.artwork, bank.stateFrames);
    expect(data.layers.map((l) => l.layerId)).toEqual(['a', 'b', 'hidden']);
    expect(data.layers[2].shapes).toEqual([]);
    expect(data.layers.flatMap((l) => l.shapes)).toEqual(legacy);
    expect(data.buttons).toEqual(snapshot.buttons);
    expect(data.signature).toBe(snapshot.signature);
    expect(data.frame).toBe(step);
    expect(h.count).toBe(calls);
    expect(h.p).toEqual(before);
    expect(Object.isFrozen(data.layers[0].shapes)).toBe(true);
    expect(data.buttons.every((b) => Object.isFrozen(b.poses.hit))).toBe(true);
  });

it('does not advance/reset/prune independent sibling clocks during repeated presentation reads', () => {
  const a = host(),
    b = host(structuredClone(a.p), false);
  for (const [frame, time, position] of [
    [0, 0, 0],
    [0, 0.5, 0],
    [1, 1, 1],
    [2, 1.5, 2],
    [3, 2, 3],
    [5, 2.5, 5],
    [6, 3, 6],
    [0, 4, 8],
    [0, 1000, 8000],
  ]) {
    const x = a.sample(frame, time, null, null, position),
      y = b.sample(frame, time, null, null, position),
      count = a.count;
    for (let read = 0; read < 3; read++) {
      const result = x.snapshot.presentation(x.bank.artwork, x.bank.stateFrames);
      expect(result.layers.flatMap((l) => l.shapes)).toEqual(
        evaluate(
          y.snapshot.render(null, null, y.bank.artwork, y.bank.stateFrames),
          frame,
          y.frames,
        ),
      );
      expect(result.buttons).toEqual(y.snapshot.buttons);
    }
    expect(a.count).toBe(count);
    expect(a.movies.origins()).toEqual(b.movies.origins());
    expect(x.bank).toEqual(y.bank);
  }
});

for (const state of ['over', 'down'] as const)
  it(`uses captured ${state} routing, mappings, ancestry and frozen Hit poses`, () => {
    const h = host(),
      first = h.sample(0, 0),
      parent = first.snapshot.buttons.find((b) => b.name === 'Wrapper')!;
    const next = h.sample(
        0,
        0.5,
        state === 'over' ? parent.token : null,
        state === 'down' ? parent.token : null,
      ),
      data = next.snapshot.presentation(next.bank.artwork, next.bank.stateFrames);
    expect(data.layers.flatMap((l) => l.shapes)).toEqual(
      evaluate(
        next.snapshot.render(
          state === 'over' ? parent.token : null,
          state === 'down' ? parent.token : null,
          next.bank.artwork,
          next.bank.stateFrames,
        ),
        0,
        next.frames,
      ),
    );
    expect(data.buttons).toEqual(next.snapshot.buttons);
    expect(data.buttons.find((b) => b.token === parent.token)!.poses.hit).toEqual(parent.poses.hit);
    const descendants = data.buttons.filter((b) => b.shape.id.startsWith('outer/'));
    expect(descendants.length).toBe(state === 'over' ? 0 : 1);
  });

it('keeps duplicate local paths in separate original layer namespaces', () => {
  const h = host(),
    s = h.sample(0, 0),
    data = s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames);
  const same = data.buttons.filter((b) => b.shape.id === 'same/child');
  expect(same.map((b) => b.layerId)).toEqual(['a', 'b']);
  expect(new Set(same.map((b) => b.token)).size).toBe(2);
  expect(same[0].shape.transform![0]).toBe(-1);
  expect(same[1].shape.x).toBe(80);
  expect(same[0].poses.hit[0].x).toBe(48.5);
  expect(same[0].poses.hit[0].y).toBe(4);
});

it('isolates private discovery from public button mutation and detaches all output/banks', () => {
  const h = host(),
    s = h.sample(0, 0),
    expected = structuredClone(s.snapshot.buttons),
    original = structuredClone(s.bank);
  s.snapshot.buttons[0].shape.x = 999;
  s.snapshot.buttons[0].poses.hit[0].fill = '#000000';
  s.snapshot.buttons.splice(1, 1);
  const data = s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames);
  expect(data.buttons).toEqual(expected);
  expect(s.bank).toEqual(original);
  expect(() => {
    data.layers[0].shapes[0].x = 200;
  }).toThrow();
  expect(() => {
    data.buttons[0].poses.hit[0].x = 200;
  }).toThrow();
  s.bank.artwork.values().next().value![0].fill = '#ffffff';
  expect(data.layers.flatMap((l) => l.shapes)).not.toContainEqual(
    expect.objectContaining({ fill: '#ffffff' }),
  );
});

for (const change of ['source', 'frames', 'origins'])
  it(`invalidates observed ${change} changes and recovers with a fresh owner`, () => {
    const h = host(),
      s = h.sample(0, 0);
    if (change === 'source') h.p.background = '#123456';
    else
      (change === 'frames' ? s.frames : s.origins)[
        Object.keys(change === 'frames' ? s.frames : s.origins)[0]
      ] += 1;
    expect(() => s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames)).toThrow();
    if (change === 'source') h.p.background = '#ffffff';
    expect(() => s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames)).toThrow('fresh');
    const fresh = host(structuredClone(h.p));
    expect(() => {
      const n = fresh.sample(0, 0);
      n.snapshot.presentation(n.bank.artwork, n.bank.stateFrames);
    }).not.toThrow();
  });

it('retains legacy rendering/defaults without opting into capture and does not clone there', () => {
  const p = layerPresentationFixture(),
    legacy = createInteractiveButtonView(p),
    clone = vi.spyOn(globalThis, 'structuredClone');
  const s = legacy.sample(0, {}, {});
  expect(s.render(null, null).layers).toHaveLength(3);
  expect(clone).not.toHaveBeenCalled();
  expect(() => s.presentation()).toThrow('Enable');
  clone.mockRestore();
});

it('captures opacity presentation without changing interaction Hit geometry or source artwork', () => {
  const p = layerPresentationFixture();
  p.opacityBindings = [
    {
      layerId: 'a',
      shapeId: 'same',
      start: 0,
      end: 4,
      keys: [
        { frame: 0, opacity: 0.25 },
        { frame: 4, opacity: 0.25 },
      ],
    },
  ];
  const before = structuredClone(p),
    view = createStageOpacityView(p)(0),
    h = host(view),
    s = h.sample(0, 0),
    data = s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames);
  expect(data.buttons.filter((b) => b.layerId === 'a')[0].shape.opacity).toBe(0.25);
  expect(data.layers[0].shapes.find((s) => s.id.startsWith('same/'))!.opacity).toBe(0.25);
  expect(p).toEqual(before);
});

for (const value of [NaN, Infinity, -Infinity])
  it(`rejects raw nonfinite bank data ${value} before rendering`, () => {
    const h = host(),
      s = h.sample(0, 0);
    s.bank.artwork.values().next().value![0].x = value;
    expect(() => s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames)).toThrow('nonfinite');
  });
it('rejects bank getters without calling them and uses native Map iteration', () => {
  let reads = 0;
  const vector = rect('bad', '#ff0000');
  Object.defineProperty(vector, 'x', {
    get() {
      reads++;
      return 0;
    },
    enumerable: true,
  });
  expect(() => capturePresentationBank(new Map([['token', [vector]]]))).toThrow('data fields');
  expect(reads).toBe(0);
  const bank = new Map([['token', [rect('ok', '#ff0000')]]]);
  bank[Symbol.iterator] = () => {
    throw Error('caller iterator');
  };
  expect(capturePresentationBank(bank)!.get('token')).toEqual([rect('ok', '#ff0000')]);
});
it('rejects invalid exact frames/duplicate layer ownership and malformed source before capture', () => {
  const p = layerPresentationFixture();
  expect(() => detachLayerPresentation(p, 0.5, {}, [], '')).toThrow('exact');
  const duplicate = structuredClone(p);
  duplicate.layers[1].id = 'a';
  expect(() => detachLayerPresentation(duplicate, 0, {}, [], '')).toThrow('ambiguous');
  p.layers[0].keys[0].shapes[0].x = NaN;
  expect(() => createInteractiveButtonView(p, { layerPresentation: true })).toThrow('nonfinite');
});

for (const change of ['bank', 'source', 'frames', 'origins', 'reentry', 'output'])
  it(`rejects late ${change} mutation during complete detached preparation`, () => {
    const h = host(),
      s = h.sample(0, 0),
      native = structuredClone;
    let hit = false;
    const clone = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, ...args) => {
      const result = native(value, ...args);
      const bank =
        Array.isArray(value) && Array.isArray(value[0]) && typeof value[0][0] === 'string';
      const output =
        !!value && typeof value === 'object' && 'layers' in value && 'signature' in value;
      if (!hit && (change === 'source' ? value === h.p : change === 'output' ? output : bank)) {
        hit = true;
        if (change === 'bank') s.bank.artwork.values().next().value![0].x = 321;
        if (change === 'source') h.p.background = '#123456';
        if (change === 'frames') s.frames[Object.keys(s.frames)[0]]++;
        if (change === 'origins') s.origins[Object.keys(s.origins)[0]]++;
        if (change === 'reentry') {
          try {
            s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames);
          } catch {
            /* The outer operation must reject swallowed reentry too. */
          }
        }
        if (change === 'output')
          (result as { layers: { shapes: { x: number }[] }[] }).layers[0].shapes[0].x = 400;
      }
      return result;
    });
    try {
      expect(() => s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames)).toThrow();
      expect(hit).toBe(true);
    } finally {
      clone.mockRestore();
    }
    expect(() => s.snapshot.presentation()).toThrow('fresh');
  });

for (const value of [-1, 0.5, NaN, Infinity])
  it(`rejects invalid clock positions ${value} only on opted-in capture`, () => {
    const p = layerPresentationFixture(),
      view = createInteractiveButtonView(p, { layerPresentation: true });
    expect(() => view.sample(0, { fake: value }, {})).toThrow();
  });
for (const mode of ['missing', 'mismatch'])
  it(`rejects ${mode} state banks without confusing the discovered visible set`, () => {
    const h = host(),
      s = h.sample(0, 0.5),
      states = structuredClone(s.bank.stateFrames),
      token = [...states.keys()].find((t) => Object.keys(states.get(t)!).length)!;
    if (mode === 'missing') states.delete(token);
    else states.get(token)![Object.keys(states.get(token)!)[0]]++;
    expect(() => s.snapshot.presentation(s.bank.artwork, states)).toThrow('match');
  });
it('can reuse privately captured state frames without resampling or external frame banks', () => {
  const h = host();
  h.sample(0, 0);
  const s = h.sample(0, 0.5),
    count = h.count;
  expect(s.snapshot.presentation(s.bank.artwork).layers).toEqual(
    s.snapshot.presentation(s.bank.artwork, s.bank.stateFrames).layers,
  );
  expect(h.count).toBe(count);
});
it('rejects changed compiled source before sampling again and leaves the default view contract intact', () => {
  const p = layerPresentationFixture(),
    view = createInteractiveButtonView(p, { layerPresentation: true });
  p.symbols![0].shapes[0].fill = '#123456';
  expect(() => view.sample(0, {}, {})).toThrow('Recreate');
  const fresh = createInteractiveButtonView(p, { layerPresentation: true });
  expect(() => fresh.sample(0, {}, {}).presentation()).not.toThrow();
});

it('rejects swallowed discovery reentry before a second state callback and permits a fresh capture', () => {
  const p = layerPresentationFixture(),
    view = createInteractiveButtonView(p, { layerPresentation: true });
  let calls = 0,
    nested = 0;
  expect(() =>
    view.sample(0, {}, {}, null, null, () => {
      calls++;
      if (calls === 1) {
        try {
          view.sample(0, {}, {}, null, null, () => {
            nested++;
            return { frames: {}, origins: {} };
          });
        } catch {
          /* The outer discovery must also reject. */
        }
      }
      return { frames: {}, origins: {} };
    }),
  ).toThrow('reentered');
  expect(nested).toBe(0);
  expect(() => view.sample(0, {}, {}).presentation()).not.toThrow();
});
it('admits finite original optional metadata without JSON normalization', () => {
  const bank = new Map([
    ['token', [{ ...rect('a', '#ff0000'), gradient: undefined, pivot: undefined }]],
  ]);
  const copy = capturePresentationBank(bank)!.get('token')![0];
  expect(Object.hasOwn(copy, 'gradient')).toBe(true);
  expect(Object.hasOwn(copy, 'pivot')).toBe(true);
  expect(copy).not.toBe(bank.get('token')![0]);
});

for (const frame of [-1, 0.5, 8, Infinity])
  it(`rejects invalid frame ${frame} before calling any state sampler`, () => {
    const view = createInteractiveButtonView(layerPresentationFixture(), {
        layerPresentation: true,
      }),
      state = vi.fn(() => ({ frames: {}, origins: {} }));
    expect(() => view.sample(frame, {}, {}, null, null, state)).toThrow('exact');
    expect(state).not.toHaveBeenCalled();
  });
