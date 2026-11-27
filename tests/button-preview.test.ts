import * as previewPlans from '../packages/animation/src/symbol-preview-clock';
import { exportHTML } from '../packages/export-web/src';
import { createButtonExposureRuntime } from '../packages/animation/src/button-exposure';
import { expect, it, vi } from 'vitest';
import { newProject, type Vector } from '../packages/document/src';
import {
  rootButtons,
  pickRootButton,
  rootButtonProject,
  createRootButtonMoviePlayback,
} from '../packages/animation/src/button-preview';
import {
  symbolInstance,
  expandSymbols,
  expandStaticButtonContainers,
} from '../packages/geometry/src/symbols';
import { evaluate } from '../packages/animation/src';

it('uses affine hit geometry, frontmost targets, exposure lifetimes and detached poses', () => {
  const p = newProject();
  p.duration = 4;
  const art: Vector = {
    id: 'a',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.symbols = [
    {
      id: 'b',
      name: 'Button',
      width: 20,
      height: 20,
      shapes: [art],
      buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
      timeline: {
        duration: 4,
        keys: [
          { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
          { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
          { frame: 3, shapes: [{ ...art, width: 10 }] },
        ],
      },
    },
  ];
  const a = symbolInstance(p.symbols[0], 100, 100);
  a.transform = [2, 0, 0, 1];
  const b = { ...a, id: 'front' };
  p.layers[0].keys = [
    { frame: 0, shapes: [a, b] },
    { frame: 2, shapes: [a] },
  ];
  const before = structuredClone(p),
    buttons = rootButtons(p, 1);
  expect(pickRootButton(buttons, { x: 110, y: 110 })?.shape.id).toBe('front');
  expect(pickRootButton(buttons, { x: 130, y: 110 })).toBeUndefined();
  expect(rootButtons(p, 2)[0].token).not.toBe(buttons[0].token);
  const rendered = rootButtonProject(p, 1, buttons, buttons[0].token, buttons[1].token);
  expect(evaluate(rendered, 1).map((s) => s.fill)).toEqual(['#00ff00', '#0000ff']);
  expect(p).toEqual(before);
  p.layers[0].visible = false;
  expect(rootButtons(p, 0)).toEqual([]);
});

it.each([false, true])(
  'button movie sessions isolate instances and reset after disappearance (static parent: %s)',
  (nested) => {
    const p = newProject();
    p.fps = 2;
    const art: Vector = {
      id: 'red',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    const leaf = {
      id: 'leaf',
      name: 'Leaf',
      width: 20,
      height: 20,
      shapes: [art],
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#0000ff' }] }] },
    };
    const movie = symbolInstance(leaf, 0, 0);
    movie.symbolPlayback = { mode: 'movie', firstFrame: 0 };
    const graphic = { id: 'graphic', name: 'Graphic', width: 20, height: 20, shapes: [movie] };
    const g = symbolInstance(graphic, 0, 0);
    const button = {
      id: 'b',
      name: 'Button',
      width: 20,
      height: 20,
      shapes: [g],
      buttonStates: { up: 0, over: 0, down: 1, hit: 1 },
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [g] }] },
    };
    p.symbols = [leaf, graphic, button];
    p.layers[0].keys[0].shapes = [symbolInstance(button, 0, 0), symbolInstance(button, 100, 0)];
    if (nested) {
      const wrapper = {
        id: 'wrapper',
        name: 'Static wrapper',
        width: 20,
        height: 20,
        shapes: [symbolInstance(button, 0, 0)],
      };
      p.symbols.push(wrapper);
      p.layers[0].keys[0].shapes = [symbolInstance(wrapper, 0, 0), symbolInstance(wrapper, 100, 0)];
    }
    const buttons = rootButtons(p, 0),
      clock = createRootButtonMoviePlayback();
    const colors = (sample: ReturnType<typeof clock.sample>) =>
      [...sample.artwork.values()].map((shapes) => shapes[0].fill);
    expect(colors(clock.sample(p, buttons, null, null, 0))).toEqual(['#ff0000', '#ff0000']);
    expect(colors(clock.sample(p, buttons, buttons[0].token, null, 0.5))).toEqual([
      '#0000ff',
      '#0000ff',
    ]);
    expect(colors(clock.sample(p, buttons, null, buttons[0].token, 0.5))).toEqual([
      '#ff0000',
      '#0000ff',
    ]);
    clock.sample(p, [buttons[1]], null, null, 0.6);
    expect(colors(clock.sample(p, buttons, null, null, 0.7))).toEqual(['#ff0000', '#0000ff']);
    clock.reset();
    expect(colors(clock.sample(p, buttons, null, null, 1))).toEqual(['#ff0000', '#ff0000']);
    const first = clock.sample(p, buttons, null, null, 10);
    expect([...first.stateOrigins.values()].map((x) => Object.values(x))).toEqual([[1], [1]]);
    const changed = clock.sample(p, buttons, null, buttons[0].token, 10);
    expect([...changed.stateOrigins.values()].map((x) => Object.values(x))).toEqual([[10], [1]]);
    const detached = changed.stateOrigins.get(buttons[0].token)!;
    detached[Object.keys(detached)[0]] = -123;
    expect(
      Object.values(
        clock.sample(p, buttons, null, buttons[0].token, 10.5).stateOrigins.get(buttons[0].token)!,
      ),
    ).toEqual([10]);
    clock.sample(p, [buttons[1]], null, null, 11);
    expect(
      Object.values(clock.sample(p, buttons, null, null, 12).stateOrigins.get(buttons[0].token)!),
    ).toEqual([12]);
    clock.reset();
    expect(clock.sample(p, [], null, null, 12).stateOrigins.size).toBe(0);
  },
);

it('root button exposure epochs invalidate skipped gaps without resetting continuous holds', () => {
  const p = newProject();
  p.duration = 4;
  p.fps = 2;
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 20,
    height: 20,
    shapes: [art],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#0000ff' }] }] },
  };
  const child = symbolInstance(leaf, 0, 0);
  child.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  const button = {
    id: 'button',
    name: 'Button',
    width: 20,
    height: 20,
    shapes: [child],
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
  };
  p.symbols = [leaf, button];
  p.layers[0].keys = [
    { frame: 0, shapes: [symbolInstance(button, 0, 0)] },
    { frame: 2, shapes: [] },
  ];
  p.layers.push({
    ...structuredClone(p.layers[0]),
    id: 'whole',
    keys: [{ frame: 0, shapes: [symbolInstance(button, 100, 0)] }],
  });
  const lifetimes = createButtonExposureRuntime<string>();
  const movies = createRootButtonMoviePlayback();
  const sample = (position: number) => {
    const buttons = rootButtons(p, position % p.duration);
    const expired = lifetimes.sample(
      buttons.map((b) => ({ id: b.token, start: b.start, end: b.end })),
      p.duration,
      position,
    );
    movies.invalidate(expired);
    const colors = [
      ...movies.sample(p, buttons, null, null, position / p.fps).artwork.values(),
    ].map((shapes) => shapes[0].fill);
    return { expired: [...expired], colors };
  };
  expect(sample(0).colors).toEqual(['#ff0000', '#ff0000']);
  expect(sample(1).colors).toEqual(['#0000ff', '#0000ff']);
  const partial = rootButtons(p, 1)[0].token;
  expect(sample(6000001)).toEqual({ expired: [partial], colors: ['#ff0000', '#0000ff'] });
  expect(sample(6000001).expired).toEqual([]); // Pausing keeps both current lifetimes.
  expect(sample(1).expired).toHaveLength(2); // Rewinding invalidates even whole holds.
  lifetimes.reset();
  expect(sample(1).expired).toEqual([]);
});

it('button exposure epochs distinguish the final hold from a continuous root exposure', () => {
  const life = createButtonExposureRuntime<number>();
  const active = [
    { id: 1, start: 3, end: 4 },
    { id: 2, start: 0, end: 4 },
  ];
  expect([...life.sample(active, 4, 3)]).toEqual([]);
  expect([...life.sample(active, 4, 7)]).toEqual([1]);
  expect([...life.sample([active[1]], 4, 8)]).toEqual([1]);
  expect([...life.sample(active, 4, 11)]).toEqual([]);
});

it.each([false, true, 'single'])(
  'routes fixed graphics with affine placement and animated boundaries (timeline: %s)',
  (timeline) => {
    const p = newProject();
    p.duration = 8;
    const art: Vector = {
      id: 'art',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    const button = {
      id: 'button',
      name: 'Button',
      width: 20,
      height: 20,
      shapes: [art],
      buttonStates: { up: 0, over: 1, down: 1, hit: 0 },
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#00ff00' }] }] },
    };
    const leaf = {
      id: 'leaf',
      name: 'Leaf',
      width: 20,
      height: 20,
      shapes: [art],
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#0000ff' }] }] },
    };
    const movie = symbolInstance(leaf, 80, 0);
    movie.symbolPlayback = { mode: 'movie', firstFrame: 0 };
    const graphic = symbolInstance(leaf, 120, 0);
    const animated = {
      id: 'animated',
      name: 'Animated boundary',
      width: 20,
      height: 20,
      shapes: [symbolInstance(button, 0, 0)],
      timeline: { duration: 2, keys: [] },
    };
    const container = {
      id: 'container',
      name: 'Static',
      ...(timeline ? { timeline: { duration: timeline === 'single' ? 4 : 1, keys: [] } } : {}),
      width: 200,
      height: 20,
      shapes: [
        symbolInstance(button, 0, 0),
        symbolInstance(button, 30, 0),
        movie,
        graphic,
        symbolInstance(animated, 160, 0),
      ],
    };
    p.symbols = [button, leaf, animated, container];
    const instance = symbolInstance(container, 100, 50);
    if (timeline === 'single') instance.symbolPlayback = { mode: 'single', firstFrame: 3 };
    instance.transform = [2, 0, 0.5, 1];
    p.layers[0].keys[0].shapes = [instance];
    const before = structuredClone(p);
    const buttons = rootButtons(p, 1);
    expect(buttons).toHaveLength(2); // Do not route through an animated parent yet.
    expect(buttons[0].shape.id).toBe(instance.id + '/' + container.shapes[0].id);
    expect(pickRootButton(buttons, { x: 125, y: 60 })?.token).toBe(buttons[0].token);
    expect(pickRootButton(buttons, { x: 185, y: 60 })?.token).toBe(buttons[1].token);
    const detached = rootButtonProject(p, 1, buttons, buttons[0].token, null);
    const frames = { [p.layers[0].id + '/' + instance.id + '/' + movie.id + '/leaf']: 1 };
    const painted = evaluate(detached, 1, frames);
    expect(painted[0].fill).toBe('#00ff00');
    expect(painted[1].fill).toBe('#ff0000');
    expect(painted[2].fill).toBe('#0000ff'); // Independent sibling movie keeps its namespace.
    expect(painted[3].fill).toBe(timeline === 'single' ? '#0000ff' : '#ff0000'); // Keep the frozen parent exposure age.
    expect(p).toEqual(before);
  },
);

it('keeps one-frame graphic track identities and visibility consistent in stage and HTML', () => {
  const p = newProject();
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const button = {
    id: 'button',
    name: 'Button',
    width: 20,
    height: 20,
    shapes: [art],
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
  };
  const child = symbolInstance(button, 0, 0);
  const wrapper = {
    id: 'wrapper',
    name: 'Layered fixed graphic',
    width: 100,
    height: 20,
    shapes: [child],
    timeline: {
      duration: 1,
      keys: [],
      layers: [
        {
          id: 'overlay',
          name: 'Overlay',
          visible: true,
          locked: true,
          keys: [{ frame: 0, shapes: [{ ...child, x: 40 }] }],
        },
        {
          id: 'hidden',
          name: 'Hidden',
          visible: false,
          locked: false,
          keys: [{ frame: 0, shapes: [{ ...child, x: 80 }] }],
        },
      ],
    },
  };
  p.symbols = [button, wrapper];
  const instance = symbolInstance(wrapper, 100, 50);
  instance.transform = [2, 0, 0, 1];
  p.layers[0].keys[0].shapes = [instance];
  const before = structuredClone(p);
  const stage = rootButtons(p, 0);
  expect(stage.map((b) => b.shape.id)).toEqual([
    instance.id + '/' + child.id,
    instance.id + '/overlay/' + child.id,
  ]);
  expect(pickRootButton(stage, { x: 190, y: 60 })?.token).toBe(stage[1].token);
  expect(pickRootButton(stage, { x: 270, y: 60 })).toBeUndefined();
  const html = exportHTML(p);
  const data = JSON.parse(
    html.slice(html.indexOf('const p=') + 8, html.indexOf(',c=document.querySelector')),
  );
  expect(data.buttons.map((b: { instanceId: string }) => b.instanceId)).toEqual(
    stage.map((b) => b.shape.id),
  );
  expect(data.buttons.map((b: { poses: { hit: { x: number }[] } }) => b.poses.hit[0].x)).toEqual([
    100, 180,
  ]);
  expect(p).toEqual(before);
  // The legacy fixed-parent helper stops at movies; HTML now routes their visible tracks.
  instance.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  expect(rootButtons(p, 0)).toEqual([]);
  const movieHTML = exportHTML(p);
  const movieData = JSON.parse(
    movieHTML.slice(
      movieHTML.indexOf('const p=') + 8,
      movieHTML.indexOf(',c=document.querySelector'),
    ),
  );
  expect(movieData.buttons.map((b: { instanceId: string }) => b.instanceId)).toEqual(
    stage.map((b) => b.shape.id),
  );
  expect(
    movieData.buttons.map((b: { poses: { hit: { x: number }[] } }) => b.poses.hit[0].x),
  ).toEqual([100, 180]);
  expect(
    movieData.buttons.map(
      (b: { scope: { path: string; duration: number; start: number; end: number } }) => b.scope,
    ),
  ).toEqual([
    expect.objectContaining({
      path: p.layers[0].id + '/' + instance.id + '/wrapper',
      duration: 1,
      start: 0,
      end: 1,
    }),
    expect.objectContaining({
      path: p.layers[0].id + '/' + instance.id + '/wrapper',
      duration: 1,
      start: 0,
      end: 1,
    }),
  ]);
  expect(movieData.movieFrames[0][0]).toEqual([{ button: 0 }, { button: 1 }]);
});

it('preserves frozen parent key ages across graphic modes offsets and layered exposures', () => {
  const p = newProject();
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 20,
    height: 20,
    shapes: [art],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
        { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
      ],
    },
  };
  for (const mode of ['loop', 'once', 'single'] as const)
    for (const firstFrame of [0, 1, 9]) {
      const child = symbolInstance(leaf, 5, 7);
      child.symbolPlayback = { mode, firstFrame };
      const wrapper = {
        id: 'wrapper',
        name: 'Frozen',
        width: 60,
        height: 30,
        shapes: [child],
        timeline: {
          duration: 8,
          keys: [{ frame: 2, shapes: [{ ...child, x: 15 }] }],
          layers: [
            {
              id: 'other',
              name: 'Other',
              visible: true,
              locked: false,
              keys: [
                { frame: 0, shapes: [{ ...child, y: 30 }] },
                { frame: 4, shapes: [{ ...child, y: 40 }] },
              ],
            },
          ],
        },
      };
      p.symbols = [leaf, wrapper];
      for (const selected of [0, 1, 2, 3, 4, 7]) {
        const instance = symbolInstance(wrapper, 100, 50);
        instance.symbolPlayback = { mode: 'single', firstFrame: selected };
        instance.transform = [2, 0.2, 0.3, 1];
        p.layers[0].keys[0].shapes = [instance];
        const before = structuredClone(p);
        const detached = expandStaticButtonContainers(p, [instance]);
        for (const rootFrame of [0, 1, 6000001])
          expect(expandSymbols(p, detached, rootFrame)).toEqual(
            expandSymbols(p, [instance], rootFrame),
          );
        expect(p).toEqual(before);
      }
    }
});

it('keeps 256 nested button movie sessions independent through state changes and skipped reentry', () => {
  const p = newProject();
  p.fps = 2;
  const art: Vector = {
    id: 'red',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 20,
    height: 20,
    shapes: [art],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#0000ff' }] }] },
  };
  const movie = symbolInstance(leaf, 0, 0);
  movie.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  const graphic = { id: 'graphic', name: 'Graphic', width: 20, height: 20, shapes: [movie] };
  const g = symbolInstance(graphic, 0, 0);
  const button = {
    id: 'b',
    name: 'Button',
    width: 20,
    height: 20,
    shapes: [g],
    buttonStates: { up: 0, over: 0, down: 1, hit: 1 },
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [g] }] },
  };

  p.duration = 4;
  const wrapper = {
    id: 'wrapper-many',
    name: 'Wrapper',
    width: 20,
    height: 20,
    shapes: [symbolInstance(button, 0, 0)],
  };
  p.symbols = [leaf, graphic, button, wrapper];
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: Array.from({ length: 256 }, (_, i) => ({
        ...symbolInstance(wrapper, i * 25, 0),
        id: `instance-${i}`,
        transform: [1, 0.2, 0.1, 1] as [number, number, number, number],
      })),
    },
    { frame: 2, shapes: [] },
  ];
  const before = structuredClone(p),
    buttons = rootButtons(p, 0),
    clock = createRootButtonMoviePlayback(),
    guard = createButtonExposureRuntime<string>();
  expect(buttons).toHaveLength(256);
  expect(new Set(buttons.map((b) => b.token)).size).toBe(256);
  const sample = (position: number, seconds: number, down: string | null = null) => {
    const expired = guard.sample(
      buttons.map((b) => ({ id: b.token, start: b.start, end: b.end })),
      p.duration,
      position,
    );
    clock.invalidate(expired);
    return clock.sample(p, buttons, null, down, seconds);
  };
  const compile = vi.spyOn(previewPlans, 'compileSymbolPreviewClockPlan');
  sample(0, 0);
  expect(compile).toHaveBeenCalledTimes(2);
  const first = sample(1, 0.5);
  for (const b of buttons) expect(first.artwork.get(b.token)![0].fill).toBe('#0000ff');
  const pressed = sample(1, 0.5, buttons[127].token);
  expect(pressed.artwork.get(buttons[127].token)![0].fill).toBe('#ff0000');
  expect(pressed.artwork.get(buttons[128].token)![0].fill).toBe('#0000ff');
  // Skip complete disappear/reenter cycles; every partial exposure must restart on return.
  const returned = sample(6000001, 3000000.5);
  for (let i = 0; i < buttons.length; i++) {
    const shape = returned.artwork.get(buttons[i].token)![0];
    expect(shape.fill).toBe('#ff0000');
    expect(shape.x).toBe(i * 25);
    expect(shape.transform).toEqual([1, 0.2, 0.1, 1]);
  }
  const advanced = sample(6000001, 3000001);
  for (const b of buttons) expect(advanced.artwork.get(b.token)![0].fill).toBe('#0000ff');
  clock.sample(
    p,
    buttons.filter((_, i) => i % 2 === 0),
    null,
    null,
    3000001,
  );
  const partial = clock.sample(p, buttons, null, null, 3000001);
  buttons.forEach((b, i) =>
    expect(partial.artwork.get(b.token)![0].fill).toBe(i % 2 ? '#ff0000' : '#0000ff'),
  );
  expect(compile).toHaveBeenCalledTimes(2);
  compile.mockRestore();
  const rebuild = vi.spyOn(previewPlans, 'compileSymbolPreviewClockPlan');
  clock.reset();
  clock.sample(p, buttons, null, null, 0);
  expect(rebuild).toHaveBeenCalledTimes(2);
  clock.sample(structuredClone(p), buttons, null, null, 0);
  expect(rebuild).toHaveBeenCalledTimes(4);
  rebuild.mockRestore();
  expect(p).toEqual(before);
});

it('composes ancestor exposure lifetimes without iterating skipped parent frames', () => {
  const life = createButtonExposureRuntime<string>();
  const parent = (id: string, position: number, start = 0, end = 2) => ({
    id,
    position,
    start,
    end,
    duration: 4,
  });
  const sample = (position: number, nestedPosition: number) =>
    life.sample(
      [
        {
          id: 'partial',
          start: 0,
          end: 8,
          ancestors: [parent('graphic', position), parent('inner', nestedPosition, 1, 3)],
        },
        { id: 'continuous', start: 0, end: 8, ancestors: [parent('other', position, 0, 4)] },
      ],
      8,
      position,
    );
  expect([...sample(1, 1)]).toEqual([]);
  expect([...sample(1, 2)]).toEqual([]); // Root paused; inner clock advances within its hold.
  expect([...sample(6000001, 6000002)]).toEqual(['partial']);
  expect([...sample(6000001, 6000002)]).toEqual([]);
  expect([...sample(6000001, 6000001)]).toEqual(['partial']); // Parent rewind within the same epoch.
  expect([
    ...life.sample(
      [{ id: 'partial', start: 0, end: 8, ancestors: [parent('replacement', 6000001)] }],
      8,
      6000001,
    ),
  ]).toEqual(['partial', 'continuous']);
  expect([...life.sample([], 8, 6000001)]).toEqual(['partial']);
  expect([...sample(6000001, 6000001)]).toEqual([]); // Observed reentry starts a new session.
  life.reset();
  expect([...sample(1, 1)]).toEqual([]);
  expect(() =>
    life.sample(
      [
        {
          id: 'deep',
          start: 0,
          end: 8,
          ancestors: Array.from({ length: 9 }, (_, i) => parent(String(i), 1)),
        },
      ],
      8,
      1,
    ),
  ).toThrow('depth');
  expect([...sample(1, 1)]).toEqual([]); // Rejected input does not replace previous state.
});

it('matches observed ancestor disappearances when intermediate samples are skipped, including serialized runtime', () => {
  const standalone = new Function(
    `return (${createButtonExposureRuntime.toString()})`,
  )() as typeof createButtonExposureRuntime;
  // Enumerate visibility at every integer tick as an independent oracle, then
  // compare only the two rendered endpoints against both runtime forms.
  for (const create of [createButtonExposureRuntime, standalone]) {
    for (const duration of [2, 3, 5]) {
      for (let start = 0; start < duration; start++) {
        for (let end = start + 1; end <= duration; end++) {
          for (const offset of [0, 1, 7]) {
            const visible = (tick: number) => {
              const frame = (tick + offset) % duration;
              return frame >= start && frame < end;
            };
            const times = Array.from({ length: 25 }, (_, i) => i).filter(visible);
            for (const from of times) {
              for (const to of times.filter((time) => time >= from)) {
                const life = create<string>();
                const sample = (tick: number) =>
                  life.sample(
                    [
                      {
                        id: 'button',
                        start: 0,
                        end: 1,
                        ancestors: [
                          { id: 'parent', start, end, duration, position: tick + offset },
                        ],
                      },
                    ],
                    1,
                    tick,
                  );
                expect([...sample(from)]).toEqual([]);
                const disappeared = Array.from({ length: to - from }, (_, i) => from + i + 1).some(
                  (tick) => !visible(tick),
                );
                expect([...sample(to)]).toEqual(disappeared ? ['button'] : []);
              }
            }
          }
        }
      }
    }
  }
});
