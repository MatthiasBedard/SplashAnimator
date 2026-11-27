import { it, expect } from 'vitest';
import { newProject, validateProject, type Vector } from '../packages/document/src';
import {
  convertToSymbol,
  expandSymbols,
  symbolInstance,
  symbolUsed,
  breakSymbol,
  duplicateSymbol,
  makeSymbolUnique,
  replaceSymbolArtwork,
  updateSymbolArtwork,
  updateSymbolTimeline,
  updateSymbolTimelines,
  symbolFrame,
} from '../packages/geometry/src/symbols';
import { worldPoint } from '../packages/geometry/src';
import { evaluate } from '../packages/animation/src';
const artwork = (): Vector => ({
  id: 'art',
  kind: 'rectangle',
  x: 50,
  y: 60,
  width: 80,
  height: 40,
  rotation: 20,
  transform: [1, 0.2, 0.3, 1],
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
it('validates nested definition edits together before publishing any replacement', () => {
  const p = newProject();
  const child = { id: 'child', name: 'Child', width: 80, height: 40, shapes: [artwork()] };
  const parent = { ...child, id: 'parent', name: 'Parent', shapes: [symbolInstance(child, 0, 0)] };
  p.symbols = [parent, child];
  const before = structuredClone(p);
  const parentEdit = { ...parent, shapes: [...parent.shapes, artwork()] };
  const cycle = { ...child, shapes: [symbolInstance(parent, 0, 0)] };
  expect(() => updateSymbolTimelines(p, [['parent', parentEdit], ['child', cycle]])).toThrow('cycle');
  expect(p).toEqual(before);
  const childEdit = { ...child, shapes: [{ ...artwork(), fill: '#0000ff' }] };
  updateSymbolTimelines(p, [['parent', parentEdit], ['child', childEdit]]);
  parentEdit.shapes.pop();
  expect(p.symbols.map(symbol => symbol.shapes.length)).toEqual([2, 1]);
  expect(p.symbols[1].shapes[0].fill).toBe('#0000ff');
});
it('supports independent graphic loop, once and single-frame instance settings', () => {
  const p = newProject(),
    l = p.layers[0];
  l.keys[0].shapes = [artwork()];
  const a = convertToSymbol(p, l.id, 0, ['art'], 'Modes');
  const d = p.symbols![0];
  d.timeline = { duration: 4, keys: [{ frame: 2, shapes: [{ ...d.shapes[0], fill: '#0000ff' }] }] };
  const b = symbolInstance(d, 200, 200);
  l.keys[0].shapes.push(b);
  a.symbolPlayback = { mode: 'single', firstFrame: 2 };
  b.symbolPlayback = { mode: 'once', firstFrame: 1 };
  expect(evaluate(p, 4).map((s) => s.fill)).toEqual(['#0000ff', '#0000ff']);
  b.symbolPlayback.mode = 'loop';
  expect(evaluate(p, 4).map((s) => s.fill)).toEqual(['#0000ff', '#ff0000']);
  expect(symbolFrame(d, 0, { mode: 'single', firstFrame: 9999 })[0].fill).toBe('#0000ff');
  expect(breakSymbol(p, a, 0)[0].fill).toBe('#0000ff');
  expect(validateProject(p)).toEqual(p);
  a.symbolPlayback.firstFrame = -1;
  expect(() => validateProject(p)).toThrow('symbol playback');
});
it('round-trips optional instance names and rejects invalid or misplaced names', () => {
  const project = newProject();
  const layer = project.layers[0];
  layer.keys[0].shapes = [artwork()];
  const instance = convertToSymbol(project, layer.id, 0, ['art'], 'Shared library symbol');
  instance.instanceName = 'Scene placement';
  expect(validateProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  expect(project.symbols![0].name).toBe('Shared library symbol');
  for (const name of ['', '   ', 'a'.repeat(201), 42]) {
    (instance as { instanceName?: unknown }).instanceName = name;
    expect(() => validateProject(project)).toThrow('symbol instance name');
  }
  delete instance.instanceName;
  project.symbols![0].shapes[0].instanceName = 'ordinary rectangle';
  expect(() => validateProject(project)).toThrow('symbol instance name');
});
it('evaluates held graphic loops relative to parent exposures with blank keys and atomic validation', () => {
  const p = newProject(),
    layer = p.layers[0];
  p.duration = 12;
  layer.keys[0].shapes = [artwork()];
  convertToSymbol(p, layer.id, 0, ['art'], 'Loop');
  const d = structuredClone(p.symbols![0]);
  d.timeline = {
    duration: 4,
    keys: [
      { frame: 2, shapes: [{ ...d.shapes[0], fill: '#0000ff' }] },
      { frame: 3, shapes: [] },
    ],
  };
  updateSymbolTimeline(p, d.id, d);
  layer.keys.push({ frame: 5, shapes: structuredClone(layer.keys[0].shapes) });
  expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((f) => evaluate(p, f)[0]?.fill)).toEqual([
    '#ff0000',
    '#ff0000',
    '#0000ff',
    undefined,
    '#ff0000',
    '#ff0000',
    '#ff0000',
    '#0000ff',
    undefined,
  ]);
  expect(breakSymbol(p, layer.keys[0].shapes[0], 2)[0].fill).toBe('#0000ff');
  const before = structuredClone(p);
  d.timeline.duration = 2;
  expect(() => updateSymbolTimeline(p, d.id, d)).toThrow();
  expect(p).toEqual(before);
  d.timeline.duration = 4;
  d.timeline.keys[0].shapes = [structuredClone(layer.keys[0].shapes[0])];
  expect(() => updateSymbolTimeline(p, d.id, d)).toThrow();
  expect(p).toEqual(before);
  expect(() => replaceSymbolArtwork(p, d.id, layer.id, 0, [])).toThrow('timeline');
});
it('commits detached definition-coordinate edits with fixed registration and rejects invalid artwork atomically', () => {
  const p = newProject(),
    layer = p.layers[0];
  layer.keys[0].shapes = [artwork()];
  convertToSymbol(p, layer.id, 0, ['art'], 'Edit');
  const definition = p.symbols![0],
    before = structuredClone(p);
  const draft = structuredClone(definition.shapes);
  draft[0].x += 15;
  draft[0].fill = '#0000ff';
  updateSymbolArtwork(p, definition.id, draft);
  expect(p.layers).toEqual(before.layers);
  expect(p.symbols![0].width).toBe(definition.width);
  expect(p.symbols![0].height).toBe(definition.height);
  draft[0].fill = '#00ff00';
  expect(p.symbols![0].shapes[0].fill).toBe('#0000ff');
  const updated = structuredClone(p);
  expect(() => updateSymbolArtwork(p, definition.id, [])).toThrow();
  expect(() => updateSymbolArtwork(p, definition.id, [{ ...draft[0], width: NaN }])).toThrow();
  expect(p).toEqual(updated);
});
it('copies definitions and replaces shared artwork without changing instance placement or source artwork', () => {
  const p = newProject(),
    layer = p.layers[0];
  layer.keys[0].shapes = [artwork()];
  const first = convertToSymbol(p, layer.id, 0, ['art'], 'Badge');
  const second = symbolInstance(p.symbols![0], 300, 250);
  layer.keys[0].shapes.push(second);
  p.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  makeSymbolUnique(p, layer.id, 0, first.id);
  expect(first.symbolId).not.toBe(second.symbolId);
  const before = structuredClone(layer.keys[0].shapes);
  const source = { ...artwork(), id: 'replacement', x: 600, y: 100, width: 120, fill: '#0000ff' };
  layer.keys[0].shapes.push(source);
  replaceSymbolArtwork(p, second.symbolId!, layer.id, 0, [source.id]);
  expect(layer.keys[0].shapes).toEqual([...before, source]);
  expect(evaluate(p, 0).map((s) => s.fill)).toEqual(['#ff0000', '#0000ff', '#0000ff']);
  const copied = duplicateSymbol(p, second.symbolId!);
  expect(copied.buttonStates).toEqual({ up: 0, over: 0, down: 0, hit: 0 });
  expect(p.symbols!.find((s) => s.id === first.symbolId)!.buttonStates).toEqual(
    copied.buttonStates,
  );
  copied.shapes[0].fill = '#00ff00';
  expect(evaluate(p, 0)[1].fill).toBe('#0000ff');
  expect(validateProject(p)).toEqual(p);
  const saved = structuredClone(p);
  expect(() => replaceSymbolArtwork(p, second.symbolId!, layer.id, 0, [first.id])).toThrow(
    'nested',
  );
  expect(p).toEqual(saved);
  layer.locked = true;
  expect(() => makeSymbolUnique(p, layer.id, 0, second.id)).toThrow('unlocked');
});
it('creates shared symbols while retaining affine artwork and instance identity', () => {
  const p = newProject();
  p.layers[0].keys[0].shapes = [artwork()];
  const original = structuredClone(p.layers[0].keys[0].shapes[0]);
  const instance = convertToSymbol(p, p.layers[0].id, 0, ['art'], 'Badge'),
    def = p.symbols![0];
  expect(validateProject(p)).toEqual(p);
  expect(symbolUsed(p, def.id)).toBe(true);
  const expanded = evaluate(p, 0)[0];
  for (const point of [
    { x: 0, y: 0 },
    { x: 80, y: 40 },
  ]) {
    const a = worldPoint(original, point),
      b = worldPoint(expanded, point);
    expect(b.x).toBeCloseTo(a.x, 9);
    expect(b.y).toBeCloseTo(a.y, 9);
  }
  const second = symbolInstance(def, 300, 200);
  p.layers[0].keys[0].shapes.push(second);
  def.shapes[0].fill = '#0000ff';
  expect(evaluate(p, 0).map((s) => s.fill)).toEqual(['#0000ff', '#0000ff']);
  second.width *= 2;
  second.height *= 3;
  second.transform = [1, 0.3, 0.2, 1];
  const expandedSecond = expandSymbols(p, [second])[0],
    local = worldPoint(def.shapes[0], { x: 80, y: 40 });
  const expected = worldPoint(second, { x: local.x * 2, y: local.y * 3 }),
    actual = worldPoint(expandedSecond, { x: 80, y: 40 });
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  const broken = breakSymbol(p, second);
  expect(broken[0].id).not.toBe(expandedSecond.id);
  expect(broken[0].fill).toBe('#0000ff');
  expect(instance.symbolId).toBe(def.id);
});
it('rejects partial stacks, missing definitions and cycles without mutating the source', () => {
  const p = newProject(),
    layer = p.layers[0];
  layer.keys[0].shapes = [artwork(), { ...artwork(), id: 'middle' }, { ...artwork(), id: 'last' }];
  const before = structuredClone(p);
  expect(() => convertToSymbol(p, layer.id, 0, ['art', 'last'], 'Bad')).toThrow('consecutive');
  expect(p).toEqual(before);
  const instance = convertToSymbol(p, layer.id, 0, ['art'], 'One');
  const copy = structuredClone(p);
  copy.symbols = [];
  const withoutDefinition = structuredClone(copy);
  expect(() => convertToSymbol(copy, layer.id, 0, [instance.id], 'Nested')).toThrow('Missing symbol');
  expect(copy).toEqual(withoutDefinition);
  expect(() => validateProject(copy)).toThrow('symbol reference');
  copy.symbols = structuredClone(p.symbols);
  copy.symbols![0].shapes = [structuredClone(instance)];
  expect(() => validateProject(copy)).toThrow('nested');
});

it('wraps grouped artwork and linked instances with the original graphic playback and affine placement', () => {
  const p = newProject(), layer = p.layers[0];
  p.duration = 20;
  const child = {
    id: 'animated', name: 'Animated', width: 80, height: 40,
    shapes: [artwork()],
    timeline: { duration: 4, keys: [{ frame: 2, shapes: [{ ...artwork(), x: 70, fill: '#0000ff' }] }] },
  };
  p.symbols = [child];
  const linked: Vector = {
    ...symbolInstance(child, 160, 34), groups: ['outer', 'inner'], rotation: 17,
    transform: [-1, 0.2, 0.3, 1], symbolPlayback: { mode: 'loop', firstFrame: 1 },
  };
  const loose = { ...artwork(), groups: ['outer'] };
  const untouched = { ...artwork(), id: 'outside', x: 290 };
  layer.keys = [{ frame: 0, shapes: [] }, { frame: 3, shapes: [loose, linked, untouched] }, { frame: 14, shapes: [] }];
  const before = Array.from({ length: 20 }, (_, frame) => evaluate(p, frame));
  const instance = convertToSymbol(p, layer.id, 8, [linked.id, loose.id], 'Wrap group');
  const wrapper = p.symbols[1];
  expect(wrapper.shapes.map(s => s.id)).toEqual([loose.id, linked.id]);
  expect(wrapper.shapes[1]).toMatchObject({
    symbolId: child.id, groups: linked.groups, transform: linked.transform, symbolPlayback: linked.symbolPlayback,
  });
  expect(p.symbols[0]).toBe(child);
  expect(layer.keys[1].shapes).toEqual([instance, untouched]);
  const after = Array.from({ length: 20 }, (_, frame) => evaluate(p, frame));
  for (const [frame, pose] of after.entries()) {
    expect(pose.map(s => s.fill)).toEqual(before[frame].map(s => s.fill));
    for (const [i, shape] of pose.entries()) {
      const point = { x: 17, y: 12 };
      const actual = worldPoint(shape, point), expected = worldPoint(before[frame][i], point);
      expect(actual.x).toBeCloseTo(expected.x, 9);
      expect(actual.y).toBeCloseTo(expected.y, 9);
    }
  }
  expect(validateProject(p)).toEqual(p);
});

it('can wrap an existing movie clip directly and rejects exceeding the nesting budget atomically', () => {
  const p = newProject(), layer = p.layers[0];
  let child = { id: 'leaf', name: 'Leaf', width: 80, height: 40, shapes: [artwork()] };
  p.symbols = [child];
  for (let i = 0; i < 6; i++) {
    child = { ...child, id: 'parent-' + i, shapes: [symbolInstance(child, 0, 0)] };
    p.symbols.push(child);
  }
  const movie = { ...symbolInstance(child, 30, 40), symbolPlayback: { mode: 'movie' as const, firstFrame: 0 } };
  layer.keys[0].shapes = [movie];
  const wrapper = convertToSymbol(p, layer.id, 0, [movie.id], 'Wrap movie');
  expect(p.symbols.at(-1)?.shapes[0]).toMatchObject({ id: movie.id, symbolId: child.id, symbolPlayback: movie.symbolPlayback });
  const before = structuredClone(p);
  expect(() => convertToSymbol(p, layer.id, 0, [wrapper.id], 'Too deep')).toThrow('nested symbol expansion budget');
  expect(p).toEqual(before);
});
