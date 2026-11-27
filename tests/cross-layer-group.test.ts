import { symbolInstance } from '../packages/geometry/src/symbols';
import { evaluate } from '../packages/animation/src';
import { expect, it, vi } from 'vitest';
import { newProject, newLayer, type Vector } from '../packages/document/src';
import { multiFrameId } from '../packages/animation/src/multi-frame';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import { createMovieTreeClock } from '../packages/animation/src/movie-tree-clock';
import { pickRootButton, rootButtons } from '../packages/animation/src/button-preview';
import { prepareCurrentLayerGroup } from '../apps/editor/src/cross-layer-group';
const rect = (id = 'same', x = 20): Vector => ({
  id,
  kind: 'rectangle',
  x,
  y: 30,
  width: 30,
  height: 20,
  rotation: 17,
  transform: [1, 0.1, 0.2, 1],
  pivot: { x: -20, y: 7 },
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
function fixture() {
  const p = newProject();
  p.duration = 12;
  p.layers = ['One', 'Two', 'Hidden', 'Locked'].map((name, i) => ({
    ...newLayer(name),
    id: 'l' + i,
    drawingMode: 'object' as const,
    visible: i !== 2,
    locked: i === 3,
    keys: [
      { frame: 0, shapes: [rect('same', 20 + 60 * i)] },
      { frame: 8, shapes: [rect('outside', 70)] },
    ],
  }));
  p.layers[0].keys[0].shapes.push(rect('island', 300));
  return p;
}
const picks = [multiFrameId('l0', 0, 'same'), multiFrameId('l1', 0, 'same')];
it('groups only adjacent masked objects on their original layer and ungroups without changing paint ownership', () => {
  const p = fixture(), layer = p.layers[0];
  layer.keys[0].shapes = [
    { ...rect('same'), rotation: 0, transform: undefined },
    { ...rect('peer', 50), rotation: 0, transform: undefined },
    { ...rect('third', 75), rotation: 0, transform: undefined },
    rect('hidden', 150),
  ];
  p.layers[1].keys[0].shapes = [{ ...rect('mask', 30), y: 20, width: 80, height: 80, rotation: 0, transform: undefined }];
  p.layerMasks = [{ maskLayerId: 'l1', layerIds: ['l0'] }];
  const before = structuredClone(p), selected = [picks[0], multiFrameId('l0', 0, 'peer')];
  const request = { kind: 'group' as const, layer: 'l0', groups: [] };
  const out = prepareCurrentLayerGroup(p, 4, selected, request);
  const grouped = out.project.layers[0].keys[0].shapes, expected = structuredClone(p);
  const group = grouped[0].groups![0];
  for (const shape of expected.layers[0].keys[0].shapes.slice(0, 2)) shape.groups = [group];
  expect(out.project).toEqual(expected);
  expect(out.selected).toEqual(selected);
  const ungrouped = prepareCurrentLayerGroup(out.project, 4, out.selected, { kind: 'ungroup' });
  for (const shape of expected.layers[0].keys[0].shapes.slice(0, 2)) shape.groups = [];
  expect(ungrouped.project).toEqual(expected);
  expect(() => prepareCurrentLayerGroup(p, 4, selected, { ...request, layer: null })).toThrow('original layer');
  expect(() => prepareCurrentLayerGroup(p, 4, [picks[0], multiFrameId('l0', 0, 'third')], request))
    .toThrow('masked stack');
  expect(p).toEqual(before);
});

it('groups original complete units on an explicit layer with exact geometry and only colliding IDs remapped', () => {
  const p = fixture(),
    before = structuredClone(p),
    out = prepareCurrentLayerGroup(p, 4, picks, { kind: 'group', layer: 'l0', groups: [] });
  const art = out.project.layers[0].keys[0].shapes;
  expect(art.map((s) => s.x)).toEqual([20, 80, 300]);
  expect(art[0].id).toBe('same');
  expect(art[1].id).not.toBe('same');
  expect(art[0].groups).toEqual(art[1].groups);
  expect(art[0].groups).toHaveLength(1);
  expect(out.project.layers[1].keys[0].shapes).toEqual([]);
  for (const [i, s] of art.slice(0, 2).entries())
    expect({ ...s, id: 'same', groups: undefined }).toEqual({
      ...before.layers[i].keys[0].shapes[0],
      groups: undefined,
    });
  expect(out.project.layers[0].keys[1]).toEqual(p.layers[0].keys[1]);
  expect(out.project.layers.slice(2)).toEqual(p.layers.slice(2));
  expect(p).toEqual(before);
  expect(out.selected).toEqual(art.slice(0, 2).map((s) => multiFrameId('l0', 0, s.id)));
});
it('new object layer bounds a later common exposure and keeps original merge modes and outside artwork', () => {
  const p = fixture();
  for (const l of p.layers.slice(0, 2)) {
    l.drawingMode = 'merge';
    l.keys.unshift({ frame: 0, shapes: [] });
    l.keys[1].frame = 3;
  }
  const before = structuredClone(p),
    out = prepareCurrentLayerGroup(
      p,
      4,
      [multiFrameId('l0', 3, 'same'), multiFrameId('l1', 3, 'same')],
      { kind: 'group', layer: null, groups: [] },
    );
  const layer = out.project.layers.find((l) => !before.layers.some((o) => o.id === l.id))!;
  expect(layer.drawingMode).toBe('object');
  expect(layer.keys.map((k) => [k.frame, k.shapes.length])).toEqual([
    [0, 0],
    [3, 2],
    [8, 0],
  ]);
  expect(out.project.duration).toBe(12);
  expect(p).toEqual(before);
  for (const source of before.layers) {
    const l = out.project.layers.find((l) => l.id === source.id)!;
    expect(l.drawingMode).toBe(source.drawingMode);
    expect(l.keys.at(-1)).toEqual(source.keys.at(-1));
  }
});
it('nested groups with equal names on different source layers remain separate under the new common group', () => {
  const p = fixture();
  for (const l of p.layers.slice(0, 2)) {
    l.keys[0].shapes[0].groups = ['g', 'child'];
    l.keys[0].shapes.splice(1, 0, { ...rect('peer', 50), groups: ['g', 'child'] });
  }
  const out = prepareCurrentLayerGroup(p, 4, picks, { kind: 'group', layer: null, groups: [] }),
    art = out.project.layers[2].keys[0].shapes;
  expect(art).toHaveLength(4);
  expect(art[0].groups).toEqual(art[1].groups);
  expect(art[2].groups).toEqual(art[3].groups);
  expect(art[0].groups![0]).toBe(art[2].groups![0]);
  expect(art[0].groups![1]).not.toBe(art[2].groups![1]);
  expect(art[0].groups).toHaveLength(3);
});
it('existing unselected destination group keeps its children and surrounding stack', () => {
  const p = fixture(),
    target = {
      ...newLayer('Destination'),
      drawingMode: 'object' as const,
      keys: [
        {
          frame: 0,
          shapes: [rect('below'), { ...rect('anchor'), groups: ['destination'] }, rect('above')],
        },
        { frame: 8, shapes: [] },
      ],
    };
  p.layers.push(target);
  const out = prepareCurrentLayerGroup(p, 4, picks, {
      kind: 'group',
      layer: target.id,
      groups: ['destination'],
    }),
    art = out.project.layers.at(-1)!.keys[0].shapes;
  expect(art.map((s) => s.id)).toEqual(['below', 'anchor', 'same', expect.any(String), 'above']);
  expect(art[2].groups![0]).toBe('destination');
  expect(art[2].groups).toEqual(art[3].groups);
  expect(art[1]).toEqual(target.keys[0].shapes[1]);
});
it('ungroups each original layer independently, retaining nested structure, IDs, paint and selection', () => {
  const p = fixture();
  for (const l of p.layers.slice(0, 2)) l.keys[0].shapes[0].groups = ['outer', 'inner'];
  const before = structuredClone(p),
    out = prepareCurrentLayerGroup(p, 4, picks, { kind: 'ungroup' });
  for (const l of out.project.layers.slice(0, 2))
    expect(l.keys[0].shapes[0].groups).toEqual(['inner']);
  expect(out.selected).toEqual(picks);
  expect(p).toEqual(before);
});
it('detaches aliased keys/shapes before grouping so hidden, locked and outside records stay exact', () => {
  const p = fixture();
  p.layers[2].keys[0] = p.layers[0].keys[0];
  p.layers[3].keys[0].shapes = p.layers[1].keys[0].shapes;
  p.layers[0].keys[1].shapes = p.layers[0].keys[0].shapes;
  const before = structuredClone(p),
    out = prepareCurrentLayerGroup(p, 4, picks, { kind: 'group', layer: 'l0', groups: [] });
  expect(out.project.layers[2]).toEqual(before.layers[2]);
  expect(out.project.layers[3]).toEqual(before.layers[3]);
  expect(out.project.layers[0].keys[1]).toEqual(before.layers[0].keys[1]);
  expect(p).toEqual(before);
});
for (const patch of ['hidden', 'locked', 'merge', 'missing', 'tween', 'selected-group'] as const)
  it(`rejects ${patch} destination without writing any original track`, () => {
    const p = fixture(),
      before = structuredClone(p);
    let layer = 'l0',
      groups: string[] = [];
    if (patch === 'hidden') layer = 'l2';
    if (patch === 'locked') layer = 'l3';
    if (patch === 'merge') p.layers[0].drawingMode = 'merge';
    if (patch === 'missing') layer = 'missing';
    if (patch === 'tween')
      p.layers[1].motionSpans = [{ id: 'owned', start: 0, end: 8, ease: 'linear', baseline: '[]' }];
    if (patch === 'selected-group') {
      p.layers[0].keys[0].shapes[0].groups = ['owned'];
      groups = ['owned'];
    }
    const original = structuredClone(p);
    expect(() => prepareCurrentLayerGroup(p, 4, picks, { kind: 'group', layer, groups })).toThrow();
    expect(p).toEqual(original);
    expect(before.layers[3]).toEqual(p.layers[3]);
  });
it('rejects one original group unit and hierarchy overflow atomically', () => {
  const p = fixture();
  p.layers[0].keys[0].shapes[0].groups = ['g'];
  expect(() =>
    prepareCurrentLayerGroup(p, 4, [picks[0]], { kind: 'group', layer: null, groups: [] }),
  ).toThrow('two complete');
  p.layers[0].keys[0].shapes[0].groups = Array.from({ length: 32 }, (_, i) => 'g' + i);
  const before = structuredClone(p);
  expect(() =>
    prepareCurrentLayerGroup(p, 4, picks, { kind: 'group', layer: null, groups: [] }),
  ).toThrow('32');
  expect(p).toEqual(before);
});
it('raw nonfinite/accessor inputs and duplicate or stale picks reject before candidate writes', () => {
  const p = fixture(),
    before = structuredClone(p);
  for (const ids of [[...picks, picks[0]], ['stale']])
    expect(() => prepareCurrentLayerGroup(p, 4, ids, { kind: 'ungroup' })).toThrow();
  expect(() => prepareCurrentLayerGroup(p, NaN, picks, { kind: 'ungroup' })).toThrow();
  const read = vi.fn(() => 'l0'),
    request = { kind: 'group', groups: [] } as unknown as {
      kind: 'group';
      layer: string;
      groups: string[];
    };
  Object.defineProperty(request, 'layer', { get: read, enumerable: true });
  expect(() => prepareCurrentLayerGroup(p, 4, picks, request)).toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(p).toEqual(before);
});
it('late original selection/request/source changes after admission reject the complete candidate', () => {
  for (const which of ['source', 'selection', 'request'] as const) {
    const p = fixture(),
      ids = [...picks],
      request = { kind: 'group' as const, layer: 'l0', groups: [] as string[] };
    let calls = 0;
    expect(() =>
      prepareCurrentLayerGroup(p, 4, ids, request, () => {
        if (++calls === 4) {
          if (which === 'source') p.name = 'user change';
          else if (which === 'selection') ids.pop();
          else request.layer = 'l1';
        }
      }),
    ).toThrow();
    expect(p.layers[0].keys[0].shapes).toHaveLength(2);
    expect(p.layers[1].keys[0].shapes).toHaveLength(1);
  }
});

it('destination group/shape namespaces cannot collide and retained picks cover the complete original outer unit', () => {
  const p = fixture();
  p.layers[1].keys[0].shapes[0].groups = ['above'];
  p.layers.push({
    ...newLayer('Destination'),
    id: 'dest',
    drawingMode: 'object',
    keys: [
      { frame: 0, shapes: [{ ...rect('anchor'), groups: ['same'] }, rect('above')] },
      { frame: 8, shapes: [] },
    ],
  });
  const out = prepareCurrentLayerGroup(p, 4, picks, {
      kind: 'group',
      layer: 'dest',
      groups: ['same'],
    }),
    art = out.project.layers.at(-1)!.keys[0].shapes;
  expect(art[1].id).not.toBe('same');
  expect(art[2].groups!.at(-1)).not.toBe('above');
  expect(art[0]).toEqual(p.layers.at(-1)!.keys[0].shapes[0]);
  expect(out.selected).toEqual(art.slice(0, 3).map((s) => multiFrameId('dest', 0, s.id)));
});

it('admits the actual layer budget exactly and rejects one extra layer without source changes', () => {
  const p = fixture();
  while (p.layers.length < 999)
    p.layers.push({ ...newLayer('Empty ' + p.layers.length), drawingMode: 'object' });
  const before = structuredClone(p),
    out = prepareCurrentLayerGroup(p, 4, picks, { kind: 'group', layer: null, groups: [] });
  expect(out.project.layers).toHaveLength(1000);
  expect(p).toEqual(before);
  p.layers.push(newLayer('Last original'));
  const full = structuredClone(p);
  expect(() =>
    prepareCurrentLayerGroup(p, 4, picks, { kind: 'group', layer: null, groups: [] }),
  ).toThrow('layers');
  expect(p).toEqual(full);
});

it('different source starts/ends and destination exposures preserve exact artwork outside their intersection', () => {
  const p = fixture();
  p.layers[0].keys = [
    { frame: 0, shapes: [rect('before')] },
    { frame: 2, shapes: [rect('same')] },
    { frame: 9, shapes: [rect('after')] },
  ];
  p.layers[1].keys = [
    { frame: 0, shapes: [] },
    { frame: 3, shapes: [rect('same', 80)] },
    { frame: 7, shapes: [] },
  ];
  const dest = {
    ...newLayer('Destination'),
    id: 'dest',
    drawingMode: 'object' as const,
    keys: [
      { frame: 0, shapes: [rect('island')] },
      { frame: 10, shapes: [] },
    ],
  };
  p.layers.push(dest);
  const before = structuredClone(p),
    out = prepareCurrentLayerGroup(
      p,
      4,
      [multiFrameId('l0', 2, 'same'), multiFrameId('l1', 3, 'same')],
      { kind: 'group', layer: 'dest', groups: [] },
    );
  expect(out.project.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 3, 7, 9]);
  expect(out.project.layers[0].keys.find((k) => k.frame === 2)!.shapes).toEqual(
    p.layers[0].keys[1].shapes,
  );
  expect(out.project.layers[0].keys.find((k) => k.frame === 3)!.shapes).toEqual([]);
  expect(out.project.layers[0].keys.find((k) => k.frame === 7)!.shapes).toEqual(
    p.layers[0].keys[1].shapes,
  );
  expect(out.project.layers[0].keys.at(-1)).toEqual(p.layers[0].keys.at(-1));
  const target = out.project.layers.at(-1)!;
  expect(target.keys.map((k) => k.frame)).toEqual([0, 3, 7, 10]);
  expect(target.keys[0]).toEqual(dest.keys[0]);
  expect(target.keys[2].shapes).toEqual(dest.keys[0].shapes);
  expect(out.selected).toHaveLength(2);
  expect(out.selected.every((id) => JSON.parse(id)[1] === 3)).toBe(true);
  expect(p).toEqual(before);
});

for (const mode of ['loop', 'once', 'single'] as const)
  it(`${mode} graphics retain their exact evaluated phase before, inside and after new group boundaries`, () => {
    const p = fixture();
    p.symbols = [
      {
        id: 'graphic',
        name: 'Graphic',
        width: 40,
        height: 40,
        shapes: [{ ...rect('leaf', 0), y: 0, rotation: 0, transform: undefined }],
        timeline: {
          duration: 6,
          keys: [
            {
              frame: 2,
              shapes: [
                { ...rect('leaf', 0), y: 0, rotation: 0, transform: undefined, fill: '#0000ff' },
              ],
            },
            {
              frame: 4,
              shapes: [
                { ...rect('leaf', 0), y: 0, rotation: 0, transform: undefined, fill: '#00ff00' },
              ],
            },
          ],
        },
      },
    ];
    const instance = symbolInstance(p.symbols[0], 20, 30);
    instance.id = 'same';
    instance.symbolPlayback = { mode, firstFrame: 1 };
    p.layers[0].keys[0].shapes[0] = instance;
    p.layers[0].keys[1].frame = 9;
    p.layers[1].keys = [
      { frame: 0, shapes: [] },
      { frame: 3, shapes: [rect('same', 80)] },
      { frame: 7, shapes: [] },
    ];
    const before = structuredClone(p),
      out = prepareCurrentLayerGroup(
        p,
        4,
        [multiFrameId('l0', 0, 'same'), multiFrameId('l1', 3, 'same')],
        { kind: 'group', layer: null, groups: [] },
      );
    const samples = (doc: typeof p, frame: number) =>
      evaluate(doc, frame)
        .map((s) => ({
          kind: s.kind,
          x: s.x,
          y: s.y,
          width: s.width,
          height: s.height,
          fill: s.fill,
          rotation: s.rotation,
          transform: s.transform,
        }))
        .sort((a, b) => a.x - b.x);
    for (let frame = 0; frame < 12; frame++)
      expect(samples(out.project, frame)).toEqual(samples(p, frame));
    expect(out.project.symbols).toEqual(p.symbols);
    expect(p).toEqual(before);
  });
it('groups and ungroups a movie on its original stack without changing the clock plan', () => {
  const p = fixture();
  const definition = {
    id: 'movie', name: 'Movie', width: 40, height: 40,
    defaultPlayback: 'movie' as const, shapes: [rect('leaf')],
    timeline: { duration: 2, keys: [] },
  };
  p.symbols = [definition];
  const original = p.layers[0].keys[0].shapes;
  original[0] = { ...symbolInstance(definition, 20, 30), id: 'same' };
  original.splice(1, 0, rect('peer', 80));
  const before = structuredClone(p), clock = compileMovieClockPlan(p);
  const ids = ['same', 'peer'].map(id => multiFrameId('l0', 0, id));
  const result = prepareCurrentLayerGroup(p, 4, ids, { kind: 'group', layer: 'l0', groups: [] });
  const art = result.project.layers[0].keys[0].shapes;
  expect(art[0].groups).toHaveLength(1);
  expect(art[0].groups).toEqual(art[1].groups);
  const expected = structuredClone(p);
  for (const shape of expected.layers[0].keys[0].shapes.slice(0, 2)) shape.groups = art[0].groups;
  expect(result.project).toEqual(expected);
  expect(compileMovieClockPlan(result.project)).toEqual(clock);
  const ungrouped = prepareCurrentLayerGroup(result.project, 4, result.selected, { kind: 'ungroup' });
  for (const shape of expected.layers[0].keys[0].shapes.slice(0, 2)) shape.groups = [];
  expect(ungrouped.project).toEqual(expected);
  expect(compileMovieClockPlan(ungrouped.project)).toEqual(clock);
  expect(p).toEqual(before);
  expect(() => prepareCurrentLayerGroup(p, 4, [
    multiFrameId('l0', 0, 'same'), multiFrameId('l0', 0, 'island'),
  ], { kind: 'group', layer: 'l0', groups: [] })).toThrow(/original stack and exposure/);
  expect(p).toEqual(before);
});

it.each(['direct', 'graphic'] as const)('moves a complete %s movie exposure across layers with identical lifetime and nested phase', (kind) => {
  const p = fixture(), [source, dest] = p.layers;
  const child = { id: 'child', name: 'Child', width: 40, height: 40, defaultPlayback: 'movie' as const,
    shapes: [rect('leaf')], timeline: { duration: 3, keys: [{ frame: 1, shapes: [] }] } };
  const movie = { id: 'movie', name: 'Movie', width: 40, height: 40, defaultPlayback: 'movie' as const,
    shapes: [symbolInstance(child, 0, 0)], timeline: { duration: 4, keys: [] } };
  const nested = { ...symbolInstance(movie, 0, 0), id: 'nested' };
  const graphic = { id: 'wrapper', name: 'Wrapper', width: 40, height: 40, shapes: [nested],
    timeline: { duration: 6, keys: [{ frame: 2, shapes: [] }, { frame: 4, shapes: [nested] }] } };
  p.symbols = [movie, child, graphic];
  source.keys = [
    { frame: 0, shapes: [] },
    { frame: 2, shapes: [
      { ...symbolInstance(kind === 'direct' ? movie : graphic, 20, 30), id: 'instance' },
      rect('peer', 80),
    ] },
    { frame: 8, shapes: [] },
  ];
  dest.keys = source.keys.map(key => ({ frame: key.frame, shapes: [] }));
  const chosen = ['instance', 'peer'].map(id => multiFrameId(source.id, 2, id));
  const request = { kind: 'group' as const, layer: dest.id, groups: [] };
  const before = structuredClone(p), out = prepareCurrentLayerGroup(p, 4, chosen, request);
  expect(out.project.layers[0].keys).toEqual(dest.keys);
  expect(out.project.layers[1].keys[1].shapes.map(({ groups, ...s }) => ({ ...s, groups }))).toEqual(
    source.keys[1].shapes.map(s => ({ ...s, groups: out.project.layers[1].keys[1].shapes[0].groups })),
  );
  expect(out.project.symbols).toEqual(before.symbols);
  const originalClock = createMovieTreeClock(), newClock = createMovieTreeClock();
  for (const at of [0, 2, 3, 4, 5, 6, 7, 8, 11, 14, 16, 18, 20]) {
    const args = [at % p.duration, at / p.fps, at] as const;
    const a = originalClock.sample(p, ...args), b = newClock.sample(out.project, ...args);
    const remap = (record: Record<string, number>) =>
      Object.fromEntries(Object.entries(record).map(([key, value]) => [key.replace(/^l0\//, 'l1/'), value]));
    expect(b).toEqual(remap(a));
    expect(newClock.origins()).toEqual(remap(originalClock.origins()));
    if (kind === 'graphic' && (at === 4 || at === 5)) expect(b).toEqual({});
    if (kind === 'graphic' && (at === 6 || at === 18))
      expect(b['l1/instance/nested/movie']).toBe(0);
  }
  const split = structuredClone(p);
  split.layers[1].keys[1].frame++;
  expect(() => prepareCurrentLayerGroup(split, 4, chosen, request)).toThrow('matching held exposures');
  const collision = structuredClone(p);
  collision.layers[1].keys[0].shapes.push(structuredClone(source.keys[1].shapes[0]));
  expect(() => prepareCurrentLayerGroup(collision, 4, chosen, request)).toThrow('artwork identity');
  const alias = structuredClone(p);
  alias.layers[2].id = 'l1/instance';
  alias.layers[2].visible = true;
  alias.layers[2].keys[0].shapes = [{ ...symbolInstance(child, 300, 30), id: 'nested' }];
  expect(() => prepareCurrentLayerGroup(alias, 4, chosen, request)).toThrow('clock namespace');
  if (kind === 'graphic') {
    const interactive = structuredClone(p);
    const button = { id: 'button', name: 'Button', width: 40, height: 40, shapes: [rect('leaf')],
      buttonStates: { up: 0, over: 0, down: 0, hit: 0 } };
    interactive.symbols!.push(button);
    interactive.symbols!.find(symbol => symbol.id === graphic.id)!.shapes.push(
      symbolInstance(button, 0, 0),
    );
    expect(() => prepareCurrentLayerGroup(interactive, 4, chosen, request)).toThrow('requires their original layer');
  }
  expect(p).toEqual(before);
});

it('groups a direct button across matching exposures while preserving Hit priority and its original lifetime', () => {
  const p = fixture();
  const ink = { ...rect('ink', 0), y: 0, rotation: 0, transform: undefined, pivot: undefined };
  const button = { id: 'button', name: 'Button', width: 40, height: 40, shapes: [ink],
    buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
    timeline: { duration: 4, keys: [1, 2, 3].map(frame => ({ frame, shapes: [ink] })) } };
  p.symbols = [button];
  p.layers[0].keys[0].shapes = [
    { ...symbolInstance(button, 20, 30), id: 'back' },
    { ...symbolInstance(button, 20, 30), id: 'front' },
    rect('peer', 100),
  ];
  p.layers[1].keys[0].shapes = [];
  const chosen = ['front', 'peer'].map(id => multiFrameId('l0', 0, id));
  const request = { kind: 'group' as const, layer: 'l1', groups: [] };
  const before = structuredClone(p);
  const out = prepareCurrentLayerGroup(p, 4, chosen, request);
  const hit = (project: typeof p, frame: number) =>
    pickRootButton(rootButtons(project, frame), { x: 25, y: 35 });
  const originalHit = hit(p, 4)!, movedHit = hit(out.project, 4)!;
  expect(originalHit.shape.id).toBe('front');
  expect(movedHit).toEqual({
    ...originalHit, layerId: 'l1', token: JSON.stringify(['l1', 0, 'front', 'button']),
    shape: { ...originalHit.shape, groups: movedHit.shape.groups }, poses: movedHit.poses,
  });
  for (const state of ['up', 'over', 'down', 'hit'] as const)
    expect(movedHit.poses[state].map(({ groups: _groups, ...shape }) => shape))
      .toEqual(originalHit.poses[state].map(({ groups: _groups, ...shape }) => shape));
  expect(hit(out.project, 8)).toBeUndefined();
  const split = structuredClone(p);
  split.layers[1].keys[1].frame--;
  expect(() => prepareCurrentLayerGroup(split, 4, chosen, request)).toThrow('matching held exposures');
  const alias = structuredClone(p);
  alias.layers[2].id = 'l1/front';
  alias.layers[2].keys[0].shapes = [rect('child', 300)];
  expect(() => prepareCurrentLayerGroup(alias, 4, chosen, request)).toThrow('button namespace');
  expect(p).toEqual(before);
});

it('selected or boundary-split independent movie descendants retain conservative rejection and complete original artwork', () => {
  const p = fixture();
  p.symbols = [
    {
      id: 'movie',
      name: 'Movie',
      width: 40,
      height: 40,
      defaultPlayback: 'movie',
      shapes: [rect('leaf')],
      timeline: { duration: 2, keys: [] },
    },
  ];
  const instance = symbolInstance(p.symbols[0], 20, 30);
  instance.id = 'same';
  p.layers[0].keys[0].shapes[0] = instance;
  const before = structuredClone(p);
  expect(() =>
    prepareCurrentLayerGroup(p, 4, picks, { kind: 'group', layer: null, groups: [] }),
  ).toThrow('independently clocked');
  expect(p).toEqual(before);
  p.layers[0].keys[0].shapes[0] = rect('same');
  p.symbols.push({
    id: 'nested',
    name: 'Nested',
    width: 40,
    height: 40,
    shapes: [symbolInstance(p.symbols[0], 0, 0)],
  });
  p.layers.push({
    ...newLayer('Clocked destination'),
    id: 'dest',
    drawingMode: 'object',
    keys: [{ frame: 0, shapes: [symbolInstance(p.symbols[1], 200, 30)] }],
  });
  const original = structuredClone(p);
  expect(() =>
    prepareCurrentLayerGroup(p, 4, picks, { kind: 'group', layer: 'dest', groups: [] }),
  ).toThrow('independently clocked');
  expect(p).toEqual(original);
});
