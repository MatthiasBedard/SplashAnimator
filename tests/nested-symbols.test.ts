import { it, expect } from 'vitest';
import {
  newProject,
  validateProject,
  migrateProject,
  type SymbolDefinition,
  type Vector,
} from '../packages/document/src';
import {
  symbolInstance,
  expandSymbols,
  updateSymbolArtwork,
  symbolUsed,
  breakSymbol,
} from '../packages/geometry/src/symbols';
import { worldPoint } from '../packages/geometry/src';
import { evaluate } from '../packages/animation/src';
const art = (): Vector => ({
  id: 'paint',
  kind: 'rectangle',
  x: 0,
  y: 0,
  width: 40,
  height: 20,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
function fixture() {
  const p = newProject();
  const leaf: SymbolDefinition = {
    id: 'leaf',
    name: 'Leaf',
    width: 40,
    height: 20,
    shapes: [art()],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...art(), fill: '#0000ff' }] },
        { frame: 2, shapes: [] },
      ],
    },
  };
  const nested = symbolInstance(leaf, 0, 0);
  const parent: SymbolDefinition = {
    id: 'parent',
    name: 'Parent',
    width: 40,
    height: 20,
    shapes: [nested],
    timeline: { duration: 5, keys: [{ frame: 3, shapes: [structuredClone(nested)] }] },
  };
  p.symbols = [parent, leaf];
  p.layers[0].keys[0].shapes = [symbolInstance(parent, 100, 100)];
  return { p, leaf, parent, nested };
}
it('resolves nested graphic holds, blanks, parent-key restart, offsets and movie-parent time', () => {
  const { p, parent, nested } = fixture();
  expect(validateProject(p)).toEqual(p);
  expect([0, 1, 2, 3, 4, 5].map((f) => evaluate(p, f)[0]?.fill)).toEqual([
    '#ff0000',
    '#0000ff',
    undefined,
    '#ff0000',
    '#0000ff',
    '#ff0000',
  ]);
  nested.symbolPlayback = { mode: 'single', firstFrame: 1 };
  expect(evaluate(p, 0)[0].fill).toBe('#0000ff');
  expect(evaluate(p, 2)[0].fill).toBe('#0000ff');
  const instance = p.layers[0].keys[0].shapes[0];
  instance.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  expect(expandSymbols(p, [instance], 0, () => 4)[0].fill).toBe('#0000ff');
  expect(breakSymbol(p, instance)[0].kind).toBe('rectangle');
  expect(symbolUsed(p, 'leaf')).toBe(true);
  delete parent.timeline;
  delete nested.symbolPlayback;
  expect(expandSymbols(p, [instance], 0, () => 100)[0].fill).toBe('#ff0000');
});
it('composes nested affine mappings, opacity, paint and namespaced group identities', () => {
  const { p, leaf, parent, nested } = fixture();
  delete leaf.timeline;
  delete parent.timeline;
  leaf.shapes[0].transform = [1, 0.2, 0.3, 1];
  leaf.shapes[0].groups = ['ink'];
  leaf.shapes[0].opacity = 0.5;
  nested.transform = [1, 0.4, 0.1, 1];
  nested.rotation = 23;
  nested.width *= 2;
  nested.groups = ['child'];
  nested.opacity = 0.5;
  const root = p.layers[0].keys[0].shapes[0];
  root.transform = [1, 0.3, 0.5, 1];
  root.height *= 2;
  root.groups = ['root'];
  root.opacity = 0.5;
  const result = evaluate(p, 0)[0];
  const a = worldPoint(leaf.shapes[0], { x: 40, y: 20 });
  const b = worldPoint(nested, { x: a.x * 2, y: a.y });
  const expected = worldPoint(root, { x: b.x, y: b.y * 2 });
  const actual = worldPoint(result, { x: 40, y: 20 });
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
  expect(result.opacity).toBe(0.125);
  expect(result.groups).toEqual(['root', root.id + '/child', root.id + '/' + nested.id + '/ink']);
  expect(result.id).toBe(root.id + '/' + nested.id + '/paint');
});
it('rejects nested cycles, missing references and exponential expansion atomically', () => {
  const { p, leaf, parent } = fixture();
  const before = structuredClone(p);
  expect(() => updateSymbolArtwork(p, leaf.id, [symbolInstance(parent, 0, 0)])).toThrow('cycle');
  expect(p).toEqual(before);
  const missing = symbolInstance(leaf, 0, 0);
  missing.symbolId = 'missing';
  expect(() => updateSymbolArtwork(p, parent.id, [missing])).toThrow('reference');
  expect(p).toEqual(before);
  let previous = leaf;
  delete leaf.timeline;
  for (let i = 0; i < 6; i++) {
    const d: SymbolDefinition = {
      id: 'wide' + i,
      name: 'Wide',
      width: 40,
      height: 20,
      shapes: Array.from({ length: 10 }, () => symbolInstance(previous, 0, 0)),
    };
    p.symbols!.push(d);
    previous = d;
  }
  expect(() => validateProject(p)).toThrow('expansion budget');
  const deep = fixture();
  let child = deep.leaf;
  for (let i = 0; i < 8; i++) {
    const d: SymbolDefinition = {
      id: 'deep' + i,
      name: 'Deep',
      width: 40,
      height: 20,
      shapes: [symbolInstance(child, 0, 0)],
    };
    deep.p.symbols!.push(d);
    child = d;
  }
  expect(() => validateProject(deep.p)).toThrow('expansion budget');
});
it('preserves released curve handles while migrating schema 23', () => {
  const p = newProject();
  const s = art();
  s.kind = 'polygon';
  s.fillRule = 'evenodd';
  s.contours = [
    [
      { x: 0, y: 0, out: { x: 10, y: 0 } },
      { x: 40, y: 20, in: { x: 40, y: 0 } },
      { x: 0, y: 20 },
    ],
  ];
  p.layers[0].keys[0].shapes = [s];
  expect(migrateProject({ ...p, schemaVersion: 23 }).layers).toEqual(p.layers);
});
