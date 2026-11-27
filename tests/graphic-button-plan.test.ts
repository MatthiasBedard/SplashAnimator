import { createButtonChildViewBank } from '../packages/animation/src/button-child-view';
import {
  createInteractiveButtonView,
  createMovieButtonViewBank,
} from '../packages/animation/src/movie-button-view';
import {
  createGraphicButtonView,
  createRootButtonMoviePlayback,
  pickRootButton,
} from '../packages/animation/src/button-preview';
import { createButtonExposureRuntime } from '../packages/animation/src/button-exposure';
import {
  compileGraphicButtonLifetimes,
  graphicButtonLifetimesAt,
} from '../packages/animation/src/graphic-button-plan';
import { expect, it } from 'vitest';
import { newProject, type SymbolDefinition, type Vector } from '../packages/document/src';
import { expandSymbols, symbolInstance } from '../packages/geometry/src/symbols';
import { matrix } from '../packages/geometry/src/affine';
import {
  compileGraphicButtonPlan,
  sampleGraphicButtonPlan,
} from '../packages/animation/src/graphic-button-plan';

function fixture() {
  const p = newProject();
  p.duration = 12;
  const art: Vector = {
    id: 'paint',
    kind: 'rectangle',
    x: 1,
    y: 2,
    width: 5,
    height: 8,
    rotation: 0,
    fill: '#f00',
    stroke: '#000',
    strokeWidth: 0,
    points: [],
  };
  const button: SymbolDefinition = {
    id: 'button',
    name: 'Button',
    width: 10,
    height: 10,
    shapes: [art],
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
  };
  const movie: SymbolDefinition = {
    id: 'movie',
    name: 'Movie',
    width: 10,
    height: 10,
    shapes: [art],
  };
  const leaf = { ...symbolInstance(button, 3, 4), id: 'leaf', groups: ['local'] };
  const sibling = {
    ...symbolInstance(movie, 9, 10),
    id: 'sibling',
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
  };
  const parent: SymbolDefinition = {
    id: 'parent',
    name: 'Parent',
    width: 20,
    height: 20,
    shapes: [leaf, sibling],
    timeline: {
      duration: 4,
      keys: [
        { frame: 2, shapes: [] },
        { frame: 3, shapes: [{ ...leaf, x: 13 }, sibling] },
      ],
    },
  };
  p.symbols = [button, movie, parent];
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: Array.from({ length: 2 }, (_, i) => ({
        ...symbolInstance(parent, 100 * i, 20),
        id: 'instance' + i,
        transform: [1, 0.2, 0.3, 2] as [number, number, number, number],
        width: 40,
        opacity: 0.5,
        symbolPlayback: { mode: 'loop' as const, firstFrame: i },
      })),
    },
  ];
  return p;
}

it('charges compiled poses and subsequent samples to a shared work budget', () => {
  const project = fixture();
  const budget = { remaining: 12 };
  const plan = compileGraphicButtonPlan(project, budget);
  expect(budget.remaining).toBe(6);
  expect(sampleGraphicButtonPlan(plan, 0, budget)).toHaveLength(4);
  expect(budget.remaining).toBe(0);
  expect(() => compileGraphicButtonPlan(project, budget)).toThrow('compilation budget');
  expect(sampleGraphicButtonPlan(plan, 0)).toHaveLength(4);
});

it('compiles shared graphic definitions and resolves advancing affine poses with distinct paths', () => {
  const p = fixture(),
    before = structuredClone(p),
    plan = compileGraphicButtonPlan(p);
  expect(plan.definitions).toHaveLength(1); // Movie/button artwork stays outside this topology.
  const standalone = new Function(
    `return (${sampleGraphicButtonPlan.toString()})`,
  )() as typeof sampleGraphicButtonPlan;
  for (const sample of [sampleGraphicButtonPlan, standalone]) {
    for (let frame = 0; frame < 12; frame++) {
      const actual = sample(JSON.parse(JSON.stringify(plan)), frame);
      const expected = expandSymbols(
        p,
        p.layers[0].keys[0].shapes,
        frame,
        undefined,
        undefined,
        (shape) => shape.symbolId === 'button' || shape.symbolPlayback?.mode === 'movie',
      );
      expect(actual.map((a) => a.shape)).toEqual(expected);
      expect(new Set(actual.map((a) => a.shape.id)).size).toBe(actual.length);
      for (const a of actual) {
        expect(a.exposures).toHaveLength(2);
        expect(a.exposures[1].duration).toBe(4);
        expect(a.button).toBe(a.shape.symbolId === 'button');
        expect(a.layerId).toBe(p.layers[0].id);
      }
    }
  }
  expect(p).toEqual(before);
  p.symbols![2].shapes[0].x = 999;
  expect(sampleGraphicButtonPlan(plan, 0)[0].shape.x).not.toBe(999);
});

it('resolves once/single frames, root held keys and visible layers without expanding movie leaves', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].symbolPlayback = { mode: 'once', firstFrame: 1 };
  p.layers[0].keys[0].shapes[1].symbolPlayback = { mode: 'single', firstFrame: 3 };
  p.layers[0].keys.push({ frame: 5, shapes: [] });
  const plan = compileGraphicButtonPlan(p);
  for (const frame of [0, 1, 2, 4]) {
    const actual = sampleGraphicButtonPlan(plan, frame);
    const expected = expandSymbols(
      p,
      p.layers[0].keys[0].shapes,
      frame,
      undefined,
      undefined,
      (s) => s.symbolId === 'button' || s.symbolPlayback?.mode === 'movie',
    );
    expect(actual.map((a) => matrix(a.shape))).toEqual(expected.map(matrix));
    expect(actual.every((a) => a.exposures[0].end === 5)).toBe(true);
  }
  expect(sampleGraphicButtonPlan(plan, 5)).toEqual([]);
  p.layers[0].visible = false;
  expect(sampleGraphicButtonPlan(compileGraphicButtonPlan(p), 0)).toEqual([]);
});

it('rejects graphic cycles and missing definitions without changing the document', () => {
  const p = fixture();
  p.symbols![2].shapes.push({ ...symbolInstance(p.symbols![2], 0, 0), id: 'cycle' });
  const before = structuredClone(p);
  expect(() => compileGraphicButtonPlan(p)).toThrow('cycle');
  expect(p).toEqual(before);
  p.symbols = [];
  expect(() => compileGraphicButtonPlan(p)).toThrow('Missing');
});

it('preserves multi-level layer namespaces and cached depth limits', () => {
  const p = fixture();
  const wrapper: SymbolDefinition = {
    id: 'wrapper',
    name: 'Wrapper',
    width: 50,
    height: 50,
    shapes: [],
    timeline: {
      duration: 6,
      keys: [],
      layers: [
        {
          id: 'upper',
          name: 'Upper',
          visible: true,
          locked: false,
          keys: [{ frame: 0, shapes: p.layers[0].keys[0].shapes }],
        },
      ],
    },
  };
  p.symbols!.push(wrapper);
  p.layers[0].keys = [
    {
      frame: 0,
      shapes: [
        {
          ...symbolInstance(wrapper, 30, 40),
          id: 'wrapper-instance',
          rotation: 25,
          groups: ['outer'],
        },
      ],
    },
  ];
  const plan = compileGraphicButtonPlan(p);
  expect(plan.definitions).toHaveLength(2);
  for (let frame = 0; frame < 12; frame++) {
    expect(sampleGraphicButtonPlan(plan, frame).map((a) => a.shape)).toEqual(
      expandSymbols(
        p,
        p.layers[0].keys[0].shapes,
        frame,
        undefined,
        undefined,
        (s) => s.symbolId === 'button' || s.symbolPlayback?.mode === 'movie',
      ),
    );
  }
  // The reused subtree was compiled shallowly first. Reuse deeper in the graph
  // must still count its full depth instead of bypassing the limit via caching.
  let previous = wrapper;
  for (let i = 0; i < 7; i++) {
    const next: SymbolDefinition = {
      id: 'depth' + i,
      name: 'Depth',
      width: 50,
      height: 50,
      shapes: [symbolInstance(previous, 0, 0)],
    };
    p.symbols!.push(next);
    previous = next;
  }
  p.layers[0].keys[0].shapes.push(symbolInstance(previous, 0, 0));
  expect(() => compileGraphicButtonPlan(p)).toThrow('depth');
});

it('resolves skipped reentry and seam continuity from compiled ancestor identities', () => {
  const p = fixture(),
    before = structuredClone(p),
    plan = compileGraphicButtonPlan(p);
  const spans = compileGraphicButtonLifetimes(plan);
  const life = createButtonExposureRuntime<string>();
  const sample = (position: number) => {
    const active = graphicButtonLifetimesAt(spans, p.duration, position % p.duration);
    return { active, expired: life.sample(active, p.duration, position) };
  };
  const at11 = sample(11);
  const at12 = sample(12);
  const offsetButton = at12.active.find((a) => a.path.startsWith('instance1/'))!;
  expect(at11.active.some((a) => a.id === offsetButton.id)).toBe(true);
  expect(at12.expired.has(offsetButton.id)).toBe(false); // Same hold across the root seam.
  const afterSkip = sample(6000012);
  expect(afterSkip.expired.has(offsetButton.id)).toBe(true);
  expect(p).toEqual(before);

  // Every routed interval matches the existing pose resolver at each root frame.
  for (let frame = 0; frame < p.duration; frame++) {
    expect(
      graphicButtonLifetimesAt(spans, p.duration, frame)
        .map((s) => s.path)
        .sort(),
    ).toEqual(
      sampleGraphicButtonPlan(plan, frame)
        .filter((p) => p.button)
        .map((p) => p.shape.id)
        .sort(),
    );
  }
});

it('keeps single-frame routed holds continuous and freezes once playback lifetimes', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].symbolPlayback = { mode: 'single', firstFrame: 0 };
  p.layers[0].keys[0].shapes[1].symbolPlayback = { mode: 'once', firstFrame: 3 };
  const spans = compileGraphicButtonLifetimes(compileGraphicButtonPlan(p));
  expect(spans).toHaveLength(2);
  expect(spans.every((s) => s.start === 0 && s.end === p.duration)).toBe(true);
  const life = createButtonExposureRuntime<string>();
  expect([...life.sample(spans, p.duration, 0)]).toEqual([]);
  expect([...life.sample(spans, p.duration, 6000000)]).toEqual([]);
});

it('bounds lifetime compilation even with empty frames and repeated expanded instances', () => {
  const plan = compileGraphicButtonPlan(fixture());
  expect(() => sampleGraphicButtonPlan(plan, 0, { remaining: 1 })).toThrow('budget');
  expect(() =>
    compileGraphicButtonLifetimes({ root: { duration: 2000001, layers: [] }, definitions: [] }),
  ).toThrow('budget');
});

it('joins compiled discovery, affine Hit, lifetime invalidation and detached button rendering', () => {
  const p = fixture(),
    before = structuredClone(p),
    view = createGraphicButtonView(p);
  const movies = createRootButtonMoviePlayback(),
    guard = createButtonExposureRuntime<string>();
  const sample = (position: number, seconds: number) => {
    const frame = position % p.duration,
      snapshot = view.sample(frame);
    const expired = guard.sample(
      snapshot.buttons.map((b) => ({ id: b.token, start: b.start, end: b.end })),
      p.duration,
      position,
    );
    movies.invalidate(expired);
    const animated = movies.sample(p, snapshot.buttons, null, null, seconds);
    return { snapshot, expired, rendered: snapshot.render(null, null, animated.artwork) };
  };
  const first = sample(0, 0);
  const b = first.snapshot.buttons[0];
  const hit = b.poses.hit[0],
    m = matrix(hit);
  const point = { x: m[4] + m[0] * 2 + m[2] * 2, y: m[5] + m[1] * 2 + m[3] * 2 };
  expect(pickRootButton(first.snapshot.buttons, point)?.token).toBe(b.token);
  expect(
    first.rendered.layers[0].keys[0].shapes.some(
      (s) => s.id === 'instance0/sibling' && s.symbolPlayback?.mode === 'movie',
    ),
  ).toBe(true);
  const returned = sample(6000000, 3000000);
  expect(returned.expired.has(b.token)).toBe(true);
  expect(returned.rendered.layers[0].keys[0].shapes).toEqual(
    first.rendered.layers[0].keys[0].shapes,
  );
  expect(view.sample(2).buttons.some((button) => button.shape.id.startsWith('instance0/'))).toBe(
    false,
  );
  expect(p).toEqual(before);
});

it('refreshes cached button artwork when placement changes without restarting its clock', () => {
  const p = fixture(),
    view = createGraphicButtonView(p),
    buttons = view.sample(0).buttons;
  const movies = createRootButtonMoviePlayback();
  const first = movies.sample(p, buttons, null, null, 0).artwork.get(buttons[0].token)!;
  const moved = buttons.map((b) => ({ ...b, shape: { ...b.shape, x: b.shape.x + 30 } }));
  const second = movies.sample(p, moved, null, null, 0).artwork.get(buttons[0].token)!;
  expect(second[0].x).toBeCloseTo(first[0].x + 30);
});

it('resolves movie-local button poses with affine placement, offsets and scope lifetime identities', () => {
  const p = fixture(),
    before = structuredClone(p),
    bank = createMovieButtonViewBank(p);
  const instance = {
    ...p.layers[0].keys[0].shapes[0],
    id: 'movie-parent',
    symbolPlayback: { mode: 'movie' as const, firstFrame: 1 },
  };
  const first = bank.sample(instance, p.layers[0].id, 0, 10);
  expect(first.buttons).toHaveLength(1);
  expect(first.buttons[0].shape.id).toBe('movie-parent/leaf');
  expect(
    first
      .render(null, null)
      .some((s) => s.id === 'movie-parent/sibling' && s.symbolPlayback?.mode === 'movie'),
  ).toBe(true);
  expect(first.render(null, null)).toEqual(
    expandSymbols(
      p,
      [instance],
      0,
      () => 0,
      (s) => s.id !== instance.id,
    ),
  );
  expect(bank.sample(instance, p.layers[0].id, 1, 10).buttons).toEqual([]);
  const later = bank.sample(instance, p.layers[0].id, 4, 10);
  expect(later.buttons[0].token).not.toBe(first.buttons[0].token); // Same pose, new partial-hold epoch.
  expect(later.buttons[0].poses).toEqual(first.buttons[0].poses);
  expect(bank.sample(instance, p.layers[0].id, 0, 20).buttons[0].token).not.toBe(
    first.buttons[0].token,
  );
  const other = bank.sample(
    { ...instance, id: 'other', x: instance.x + 200 },
    p.layers[0].id,
    0,
    10,
  );
  expect(other.buttons[0].token).not.toBe(first.buttons[0].token);
  expect(other.buttons[0].poses.hit[0].x).toBeCloseTo(first.buttons[0].poses.hit[0].x + 200);
  expect(p).toEqual(before);
});

it('keeps whole-movie button holds continuous while parent origin replacement expires them', () => {
  const p = fixture();
  p.symbols![2].timeline = { duration: 4, keys: [] };
  const bank = createMovieButtonViewBank(p);
  const instance = {
    ...p.layers[0].keys[0].shapes[0],
    symbolPlayback: { mode: 'movie' as const, firstFrame: 0 },
  };
  const first = bank.sample(instance, p.layers[0].id, 0, 0).buttons[0];
  expect(bank.sample(instance, p.layers[0].id, 6000000, 0).buttons[0].token).toBe(first.token);
  expect(bank.sample(instance, p.layers[0].id, 0, 600000).buttons[0].token).not.toBe(first.token);
});

it('samples nested button mapped-state leaves with affine Hit, movie namespaces and source isolation', () => {
  const p = fixture();
  const parent = p.symbols!.find((d) => d.id === 'parent')!;
  parent.buttonStates = { up: 0, over: 0, down: 3, hit: 2 };
  const before = structuredClone(p);
  const roots = createGraphicButtonView(p).sample(0).buttons;
  const bank = createButtonChildViewBank(p);
  const first = bank.sample(roots[0], 'up');
  const second = bank.sample(roots[1], 'up');
  expect(first.buttons).toHaveLength(1);
  expect(second.buttons[0].token).not.toBe(first.buttons[0].token);
  const child = first.buttons[0];
  expect(child.start).toBe(roots[0].start);
  expect(child.end).toBe(roots[0].end);
  expect(child.shape.id).toBe(roots[0].shape.id + '/leaf');
  const placeholders = new Map([[child.token, [child.shape]]]);
  const leaves = first.render(null, null, placeholders);
  expect(leaves.map((s) => s.id)).toEqual([
    roots[0].shape.id + '/leaf',
    roots[0].shape.id + '/sibling',
  ]);
  expect(leaves[1].symbolPlayback?.mode).toBe('movie');
  const expected = expandSymbols(p, [
    { ...roots[0].shape, symbolPlayback: { mode: 'single', firstFrame: 0 } },
  ]);
  const actual = expandSymbols(p, first.render(null, null));
  expect(actual.map((s) => [s.id, matrix(s), s.opacity, s.groups])).toEqual(
    expected.map((s) => [s.id, matrix(s), s.opacity, s.groups]),
  );
  const hit = child.poses.hit[0],
    m = matrix(hit);
  expect(
    pickRootButton(first.buttons, { x: m[4] + m[0] * 2 + m[2] * 2, y: m[5] + m[1] * 2 + m[3] * 2 }),
  ).toBe(child);
  expect(bank.sample(roots[0], 'over').buttons[0].token).toBe(child.token);
  const changed = bank.sample(roots[0], 'down');
  expect(changed.buttons[0].token).not.toBe(child.token);
  expect(matrix(changed.buttons[0].shape)).not.toEqual(matrix(child.shape));
  expect(
    bank.sample({ ...roots[0], token: 'new-parent-lifetime' }, 'up').buttons[0].token,
  ).not.toBe(child.token);
  expect(p).toEqual(before);
});
it('button state discovery excludes Hit-only children and traverses graphics while retaining movie leaves', () => {
  const p = fixture();
  const parent = p.symbols!.find((d) => d.id === 'parent')!;
  const wrapper: SymbolDefinition = {
    id: 'wrapper',
    name: 'Wrapper',
    width: 20,
    height: 20,
    shapes: structuredClone(parent.shapes),
  };
  p.symbols!.push(wrapper);
  parent.shapes = [{ ...symbolInstance(wrapper, 4, 5), id: 'graphic' }];
  parent.buttonStates = { up: 2, over: 0, down: 0, hit: 3 };
  const root = createGraphicButtonView(p).sample(0).buttons[0];
  const bank = createButtonChildViewBank(p);
  expect(bank.sample(root, 'up').buttons).toEqual([]);
  const active = bank.sample(root, 'over');
  expect(active.buttons[0].shape.id).toBe(root.shape.id + '/graphic/leaf');
  expect(bank.sample(root, 'down').buttons[0].token).toBe(active.buttons[0].token);
  const placeholders = new Map(active.buttons.map((b) => [b.token, [b.shape]]));
  expect(active.render(null, null, placeholders).map((s) => s.id)).toEqual([
    root.shape.id + '/graphic/leaf',
    root.shape.id + '/graphic/sibling',
  ]);
  expect(() => bank.sample({ ...root, shape: { ...root.shape, symbolId: 'movie' } }, 'up')).toThrow(
    'button parent',
  );
});

it('routes nested button states before parent targets and retains independent state movie namespaces', () => {
  const p = fixture();
  p.fps = 2;
  const parent = p.symbols!.find((d) => d.id === 'parent')!;
  parent.buttonStates = { up: 0, over: 0, down: 2, hit: 0 };
  const child = p.symbols!.find((d) => d.id === 'button')!;
  const movie = p.symbols!.find((d) => d.id === 'movie')!;
  movie.timeline = {
    duration: 3,
    keys: [
      { frame: 1, shapes: [{ ...movie.shapes[0], fill: '#00ff00' }] },
      { frame: 2, shapes: [{ ...movie.shapes[0], fill: '#0000ff' }] },
    ],
  };
  child.shapes = [
    {
      ...symbolInstance(movie, 0, 0),
      id: 'child-movie',
      symbolPlayback: { mode: 'movie', firstFrame: 1 },
    },
  ];
  const before = structuredClone(p);
  const view = createInteractiveButtonView(p),
    clocks = createRootButtonMoviePlayback();
  const first = view.sample(0, {}, {});
  expect(first.buttons.map((b) => b.name)).toEqual(['Parent', 'Button', 'Parent', 'Button']);
  const root = first.buttons[0],
    leaf = first.buttons[1];
  const art0 = clocks.sample(p, first.buttons, null, null, 0);
  const rendered0 = first.render(null, null, art0.artwork, art0.stateFrames).layers[0].keys[0]
    .shapes;
  expect(rendered0.map((s) => s.id)).toEqual([
    'instance0/leaf/child-movie/paint',
    'instance0/sibling/paint',
    'instance1/leaf/child-movie/paint',
    'instance1/sibling/paint',
  ]);
  expect(rendered0.map((s) => s.fill)).toEqual(['#00ff00', '#f00', '#00ff00', '#f00']);
  const same = view.sample(0, {}, {}, root.token);
  expect(same.buttons[1].token).toBe(leaf.token);
  const art1 = clocks.sample(p, same.buttons, root.token, null, 0.5);
  expect(
    same
      .render(root.token, null, art1.artwork, art1.stateFrames)
      .layers[0].keys[0].shapes.map((s) => s.fill),
  ).toEqual(['#0000ff', '#00ff00', '#0000ff', '#00ff00']);
  const hidden = view.sample(0, {}, {}, null, root.token);
  expect(hidden.buttons.some((b) => b.token === leaf.token)).toBe(false);
  expect(hidden.buttons).toHaveLength(3);
  expect(p).toEqual(before);
});

it('routes state-movie descendants using current parent clocks with scoped reentry identities', () => {
  const p = fixture();
  p.fps = 2;
  const parent = p.symbols!.find((d) => d.id === 'parent')!;
  const child = p.symbols!.find((d) => d.id === 'button')!;
  const container: SymbolDefinition = {
    id: 'state-movie',
    name: 'State movie',
    width: 20,
    height: 20,
    shapes: [symbolInstance(child, 0, 0)],
    timeline: { duration: 4, keys: [{ frame: 2, shapes: [] }] },
  };
  p.symbols!.push(container);
  parent.buttonStates = { up: 0, over: 0, down: 2, hit: 0 };
  parent.shapes = [
    {
      ...symbolInstance(container, 0, 0),
      id: 'state',
      symbolPlayback: { mode: 'movie', firstFrame: 0 },
    },
  ];
  const original = structuredClone(p),
    view = createInteractiveButtonView(p),
    clocks = createRootButtonMoviePlayback();
  const sample = (time: number, down: string | null = null) => {
    const snapshot = view.sample(0, {}, {}, null, down, (button) => {
      const state = clocks.sample(p, [button], null, down, time, false);
      return {
        frames: state.stateFrames.get(button.token)!,
        origins: state.stateOrigins.get(button.token)!,
      };
    });
    const state = clocks.sample(p, snapshot.buttons, null, down, time);
    return { snapshot, paint: snapshot.render(null, down, state.artwork, state.stateFrames) };
  };
  const initial = sample(0);
  expect(initial.snapshot.buttons.map((b) => b.name)).toEqual([
    'Parent',
    'Button',
    'Parent',
    'Button',
  ]);
  const token = initial.snapshot.buttons[1].token;
  expect(initial.paint.layers[0].keys[0].shapes).toHaveLength(2);
  expect(sample(0.5).snapshot.buttons[1].token).toBe(token);
  expect(sample(1).snapshot.buttons.map((b) => b.name)).toEqual(['Parent', 'Parent']);
  const returned = sample(2);
  expect(returned.snapshot.buttons[1].token).not.toBe(token);
  expect(sample(3000000).snapshot.buttons[1].token).not.toBe(returned.snapshot.buttons[1].token);
  expect(
    sample(3000000, initial.snapshot.buttons[0].token).snapshot.buttons.map((b) => b.name),
  ).toEqual(['Parent', 'Parent', 'Button']);
  expect(p).toEqual(original);
});

it.each(['single', 'once'] as const)('compiles long %s button holds within the existing budget', (mode) => {
  const p = fixture();
  p.duration = 10000;
  const source = p.layers[0].keys[0].shapes[0];
  p.layers[0].keys[0].shapes = Array.from({ length: 200 }, (_, i) => ({
    ...source, id: `held${i}`, symbolPlayback: { mode, firstFrame: 0 },
  }));
  const spans = compileGraphicButtonLifetimes(compileGraphicButtonPlan(p));
  expect(graphicButtonLifetimesAt(spans, p.duration, 9999)).toHaveLength(200);
  expect(spans).toHaveLength(mode === 'single' ? 200 : 400);
  expect(spans.filter(s => s.end === 10000).every(s => s.start === (mode === 'single' ? 0 : 3))).toBe(true);
});

it('keeps authored boundaries and advancing siblings while skipping stopped button tails', () => {
  const p = fixture();
  p.duration = 30;
  p.layers[0].keys[0].shapes[0].symbolPlayback = { mode: 'once', firstFrame: 0 };
  p.layers[0].keys.push({ frame: 15, shapes: structuredClone(p.layers[0].keys[0].shapes) });
  const plan = compileGraphicButtonPlan(p), spans = compileGraphicButtonLifetimes(plan);
  for (let frame = 0; frame < p.duration; frame++) {
    const expected = sampleGraphicButtonPlan(plan, frame).filter(pose => pose.button).map(pose =>
      JSON.stringify([pose.layerId, pose.shape.id, pose.shape.symbolId,
        pose.exposures.map(e => [e.path, e.start, e.end])])).sort();
    expect(graphicButtonLifetimesAt(spans, p.duration, frame).map(s => s.id).sort()).toEqual(expected);
  }
  expect(spans.some(s => s.start === 15)).toBe(true);
  p.duration = 10000;
  p.layers[0].keys = [{ frame: 0, shapes: Array.from({ length: 200 }, (_, i) => ({
    ...p.layers[0].keys[0].shapes[1], id: `loop${i}`,
  })) }];
  expect(() => compileGraphicButtonLifetimes(compileGraphicButtonPlan(p))).toThrow('budget');
});


it('compiles advancing long graphic button holds without redundant frame visits', () => {
  const p=fixture(), parent=p.symbols!.find(d=>d.id==='parent')!;
  p.duration=10000;
  parent.timeline!.duration=1000;
  parent.timeline!.keys[0].frame=500;
  parent.timeline!.keys[1].frame=750;
  const source=p.layers[0].keys[0].shapes[0];
  p.layers[0].keys[0].shapes=Array.from({length:200},(_,i)=>({...source,id:`loop${i}`,symbolPlayback:{mode:'loop' as const,firstFrame:100}}));
  const plan=compileGraphicButtonPlan(p), spans=compileGraphicButtonLifetimes(plan);
  for(const frame of [0,399,400,649,650,899,900,1399,1400,9999]) {
    const expected=sampleGraphicButtonPlan(plan,frame).filter(pose=>pose.button).map(pose=>
      JSON.stringify([pose.layerId,pose.shape.id,pose.shape.symbolId,pose.exposures.map(e=>[e.path,e.start,e.end])])).sort();
    expect(graphicButtonLifetimesAt(spans,p.duration,frame).map(s=>s.id).sort()).toEqual(expected);
  }
  expect(graphicButtonLifetimesAt(spans,p.duration,400)).toHaveLength(0);
  expect(graphicButtonLifetimesAt(spans,p.duration,650)).toHaveLength(200);
});


it('matches every nested button exposure identity across offset wraps and clamp boundaries', () => {
  const p=fixture(), parent=p.symbols!.find(d=>d.id==='parent')!;
  p.duration=133;
  parent.timeline!.duration=7;
  parent.timeline!.keys[1].frame=5;
  const outer:SymbolDefinition={id:'outer',name:'Outer',width:20,height:20,
    shapes:(['loop','once','single'] as const).map((mode,i)=>({
      ...symbolInstance(parent,0,0),id:mode,symbolPlayback:{mode,firstFrame:i+1},
    })),timeline:{duration:19,keys:[]}};
  outer.timeline!.keys=[{frame:11,shapes:[structuredClone(outer.shapes[0])]}];
  p.symbols!.push(outer);
  const wrappers=(['loop','once','single'] as const).map((mode)=>({
    ...symbolInstance(outer,0,0),id:mode,symbolPlayback:{mode,firstFrame:4},
  }));
  p.layers[0].keys=[{frame:0,shapes:wrappers},{frame:61,shapes:[{...wrappers[0],symbolPlayback:{mode:'loop',firstFrame:17}}]}];
  const plan=compileGraphicButtonPlan(p), spans=compileGraphicButtonLifetimes(plan);
  // Full-frame sampling is independent of next-change prediction.
  for(let frame=0;frame<p.duration;frame++) {
    const expected=sampleGraphicButtonPlan(plan,frame).filter(pose=>pose.button).map(pose=>
      JSON.stringify([pose.layerId,pose.shape.id,pose.shape.symbolId,pose.exposures.map(e=>[e.path,e.start,e.end])])).sort();
    expect(graphicButtonLifetimesAt(spans,p.duration,frame).map(s=>s.id).sort(),`frame ${frame}`).toEqual(expected);
  }
  expect(spans.some(s=>s.start===61)).toBe(true);
});
