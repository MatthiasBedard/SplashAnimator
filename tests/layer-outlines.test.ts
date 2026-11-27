import { expect, it } from 'vitest';
import { newProject, newLayer, validateProject } from '../packages/document/src';
import { evaluate } from '../packages/animation/src';
import { duplicateLayer } from '../packages/animation/src/layers';

it('keeps omitted authoring settings absent and roundtrips explicit settings', () => {
  const p = newProject();
  expect(p.layers[0]).not.toHaveProperty('outline');
  expect(p.layers[0]).not.toHaveProperty('outlineColor');
  p.layers[0].outline = true;
  p.layers[0].outlineColor = '#fF8800';
  expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  const ids = duplicateLayer(p, p.layers[0].id);
  const copied = p.layers.find((l) => l.id === ids)!;
  expect(copied.outline).toBe(true);
  expect(copied.outlineColor).toBe('#fF8800');
});

for (const field of ['outline', 'outlineColor'])
  for (const value of [null, 1, NaN, {}, [], 'red', '#fff'])
    it(`rejects malformed ${field} ${String(value)} without modifying source`, () => {
      const p = newProject();
      Object.assign(p.layers[0], { [field]: value });
      const before = structuredClone(p);
      expect(() => validateProject(p)).toThrow(/layer outline/);
      expect(p).toEqual(before);
    });

it('outline preferences do not change evaluated artwork, including invisible layers', () => {
  const p = newProject();
  p.layers[0].keys[0].shapes.push({
    id: 'a',
    kind: 'rectangle',
    x: 20,
    y: 30,
    width: 40,
    height: 50,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  const before = evaluate(p, 0);
  p.layers[0].outline = true;
  p.layers[0].outlineColor = '#123456';
  expect(evaluate(validateProject(p), 0)).toEqual(before);
  p.layers[0].visible = false;
  expect(evaluate(p, 0)).toEqual([]);
  const other = newLayer('Other');
  other.outline = false;
  p.layers.push(other);
  expect(validateProject(p)).toEqual(p);
});

it('preserves outline preferences in library-local layers and rejects malformed nested colors', () => {
  const p = newProject(),
    child = newLayer('Child');
  child.keys[0].shapes.push({
    id: 'child-art',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  });
  child.outline = true;
  child.outlineColor = '#00ff00';
  p.symbols = [
    {
      id: 'library',
      name: 'Library',
      width: 10,
      height: 10,
      shapes: structuredClone(child.keys[0].shapes),
      timeline: { duration: 1, keys: [], layers: [child] },
    },
  ];
  expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  child.outlineColor = '#fff';
  expect(() => validateProject(p)).toThrow(/layer outline color/);
});
