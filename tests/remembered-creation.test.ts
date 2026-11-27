import { expect, it } from 'vitest';
import {
  newProject,
  symbolLayers,
  type SymbolDefinition,
  type Vector,
} from '../packages/document/src';
import {
  createBasicMotionSpan,
  editSymbolBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import {
  assertRememberedCreation,
  watchRememberedCreationInputs,
  type RememberedCreationRecipe,
} from '../apps/editor/src/remembered-creation';
function fixture() {
  const p = newProject();
  p.duration = 24;
  const a: Vector = {
    id: 'a',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    opacity: 0,
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 8, shapes: [{ ...a, x: 80, fill: '#808080', opacity: 1 }] },
    { frame: 10, shapes: [] },
  ];
  const recipe: RememberedCreationRecipe = {
    ids: [p.layers[0].id],
    start: 0,
    end: 8,
    ease: 'in',
    options: { paint: true },
    opacityEase: 'out',
    paintEase: { kind: 'cubic', x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 0 },
  };
  const candidate = structuredClone(p);
  createBasicMotionSpan(
    candidate,
    recipe.ids,
    0,
    8,
    recipe.ease,
    recipe.options,
    undefined,
    undefined,
    undefined,
    recipe.opacityEase,
    recipe.paintEase,
  );
  return { p, candidate, recipe };
}
it('admits only the complete requested creation without source writes', () => {
  const f = fixture(),
    before = structuredClone(f.p);
  assertRememberedCreation(f.p, f.candidate, f.recipe);
  expect(f.p).toEqual(before);
});
it('admits isolated base-layer metadata ordering without changing paint or artwork order', () => {
  const f = fixture(),
    layer = f.p.layers[0],
    s: SymbolDefinition = {
      id: 's',
      name: 's',
      width: 100,
      height: 100,
      shapes: layer.keys[0].shapes,
      timeline: { duration: 24, keys: layer.keys.slice(1) },
    };
  const recipe = { ...f.recipe, ids: ['@base'] };
  const output = editSymbolBasicMotionSpan(
    s,
    recipe.ids,
    0,
    8,
    'create',
    recipe.ease,
    [s],
    undefined,
    false,
    recipe.options,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    recipe.opacityEase,
    recipe.paintEase,
  );
  expect(() =>
    assertRememberedCreation(
      { layers: symbolLayers(s), duration: 24, symbols: [s] },
      { layers: symbolLayers(output), duration: 24, symbols: [s] },
      recipe,
    ),
  ).not.toThrow();
});
for (const change of [
  'settings',
  'generated',
  'endpoint',
  'outside',
  'metadata',
  'unselected',
  'resources',
  'empty',
] as const)
  it('rejects prepared creation tampering: ' + change, () => {
    const f = fixture();
    if (change === 'settings') f.candidate.layers[0].motionSpans![0].paintEase = 'out';
    if (change === 'generated') f.candidate.layers[0].keys[4].shapes[0].fill = '#ffffff';
    if (change === 'endpoint') f.candidate.layers[0].keys[0].shapes[0].x++;
    if (change === 'outside')
      f.candidate.layers[0].keys
        .at(-1)!
        .shapes.push({ ...f.candidate.layers[0].keys[0].shapes[0], id: 'extra' });
    if (change === 'metadata') f.candidate.layers[0].name = 'forged';
    if (change === 'unselected') {
      const other = { ...structuredClone(f.p.layers[0]), id: 'other' };
      f.p.layers.push(other);
      f.candidate.layers.push({ ...structuredClone(other), name: 'forged' });
    }
    if (change === 'resources') f.candidate.symbols = [];
    if (change === 'empty') f.recipe.ids = [];
    expect(() => assertRememberedCreation(f.p, f.candidate, f.recipe)).toThrow();
  });
it('admits a new earlier recipe without changing an existing later recipe', () => {
  const f = fixture(),
    layer = f.p.layers[0];
  layer.keys.push(
    { ...structuredClone(layer.keys[0]), frame: 12 },
    { ...structuredClone(layer.keys[1]), frame: 20 },
    { frame: 22, shapes: [] },
  );
  createBasicMotionSpan(f.p, f.recipe.ids, 12, 20, 'linear', { paint: true });
  const candidate = structuredClone(f.p);
  createBasicMotionSpan(
    candidate,
    f.recipe.ids,
    0,
    8,
    f.recipe.ease,
    f.recipe.options,
    undefined,
    undefined,
    undefined,
    f.recipe.opacityEase,
    f.recipe.paintEase,
  );
  expect(() => assertRememberedCreation(f.p, candidate, f.recipe)).not.toThrow();
});
for (const event of ['input', 'change', 'click', 'keydown'])
  it('nested ' + event + ' rejects changed-and-restored inputs and listeners dispose', () => {
    const target = new EventTarget(),
      first = watchRememberedCreationInputs(target);
    expect(() => first.validate()).not.toThrow();
    target.dispatchEvent(new Event(event));
    target.dispatchEvent(new Event(event));
    expect(() => first.validate()).toThrow(/changed/);
    first.dispose();
    const next = watchRememberedCreationInputs(target);
    next.dispose();
    target.dispatchEvent(new Event(event));
    expect(() => next.validate()).not.toThrow();
  });
