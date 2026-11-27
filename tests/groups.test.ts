import { describe, expect, it } from 'vitest';
import { id, newProject, clone, validateProject, type Vector } from '../packages/document/src';
import {
  groupVectors,
  ungroupVectors,
  expandSelection,
  copyVectors,
  inScope,
  reparentVectors,
} from '../packages/document/src/groups';
const shape = (): Vector => ({
  id: id(),
  kind: 'rectangle',
  x: 10,
  y: 20,
  width: 40,
  height: 50,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
describe('nested editable groups', () => {
  it('expands broad reversed and duplicate picks in paint order with isolated scope ownership', () => {
    const shapes = Array.from({length: 12000}, (_, index) => ({
      ...shape(), id: `item-${index}`, groups: [index < 6000 ? 'left' : 'right', `unit-${Math.floor(index / 3)}`],
    }));
    const picks = shapes.filter((_, index) => index % 3 === 1).map(s => s.id).reverse();
    picks.push(picks[0], 'missing');
    const before = clone(shapes);
    expect(expandSelection(shapes, picks, ['left'])).toEqual(shapes.slice(0,6000).map(s => s.id));
    expect(expandSelection(shapes, picks, ['right'])).toEqual(shapes.slice(6000).map(s => s.id));
    expect(expandSelection(shapes, picks, [])).toEqual(shapes.map(s => s.id));
    expect(expandSelection(shapes, picks, ['absent'])).toEqual([]);
    expect(shapes).toEqual(before);
  });
  it('places complete moved units before or after a destination unit without splitting nested siblings', () => {
    for (const side of ['before', 'after'] as const) {
      const a = { ...shape(), groups: ['source', 'moved'] },
        b = { ...shape(), groups: ['source', 'moved', 'nested'] };
      const x = { ...shape(), groups: ['target', 'anchor'] },
        y = { ...shape(), groups: ['target', 'anchor', 'child'] };
      const z = { ...shape(), groups: ['target'] },
        outside = shape();
      const shapes = [a, b, x, y, z, outside],
        before = clone(shapes);
      reparentVectors(shapes, [b.id], ['source'], ['target'], { anchor: y.id, side });
      expect(shapes.map((s) => s.id)).toEqual(
        (side === 'before' ? [a, b, x, y, z, outside] : [x, y, a, b, z, outside]).map((s) => s.id),
      );
      expect(a.groups).toEqual(['target', 'moved']);
      expect(b.groups).toEqual(['target', 'moved', 'nested']);
      for (const original of before)
        expect({ ...shapes.find((s) => s.id === original.id), groups: original.groups }).toEqual(
          original,
        );
      const p = newProject();
      p.layers[0].keys[0].shapes = shapes;
      expect(validateProject(p)).toEqual(p);
    }
  });
  it('reorders same-scope complete units and resolves an anchor after removing noncontiguous selections', () => {
    const a = shape(),
      b = { ...shape(), groups: ['anchor'] },
      c = { ...shape(), groups: ['anchor', 'nested'] },
      d = shape(),
      e = shape();
    const shapes = [a, b, c, d, e];
    const original = clone(shapes);
    reparentVectors(shapes, [a.id, d.id], [], [], { anchor: c.id, side: 'after' });
    expect(shapes).toEqual([b, c, a, d, e]);
    reparentVectors(shapes, [b.id], [], [], { anchor: e.id, side: 'after' });
    expect(shapes).toEqual([a, d, e, b, c]);
    for (const item of original) expect(shapes.find(s => s.id === item.id)).toEqual(item);
    const before = clone(shapes);
    reparentVectors(shapes, [b.id], [], []);
    expect(shapes).toEqual(before);
  });
  it('rejects malformed, stale, selected or out-of-destination placement anchors atomically', () => {
    const a = { ...shape(), groups: ['source'] },
      b = { ...shape(), groups: ['target'] },
      c = shape();
    const shapes = [a, b, c];
    const invalid: unknown[] = [
      null,
      {},
      [],
      { anchor: b.id, side: 'middle' },
      { anchor: b.id, side: 'before', extra: true },
      { anchor: 0, side: 'before' },
      { anchor: 'missing', side: 'after' },
      { anchor: a.id, side: 'before' },
      { anchor: c.id, side: 'after' },
    ];
    for (const placement of invalid) {
      const before = clone(shapes);
      expect(() =>
        reparentVectors(
          shapes,
          [a.id],
          [],
          ['target'],
          placement as Parameters<typeof reparentVectors>[4],
        ),
      ).toThrow();
      expect(shapes).toEqual(before);
    }
  });
  it('extracts the sole descendant into its ancestor at the original stack position', () => {
    const below = shape(),
      above = shape(),
      a = { ...shape(), groups: ['outer', 'inner'] };
    const shapes = [below, a, above],
      before = clone(a);
    reparentVectors(shapes, [a.id], ['outer', 'inner'], ['outer']);
    expect(shapes.map((s) => s.id)).toEqual([below.id, a.id, above.id]);
    expect(a).toEqual({ ...before, groups: ['outer'] });
    const p = newProject();
    p.layers[0].keys[0].shapes = shapes;
    expect(validateProject(p)).toEqual(p);
    reparentVectors(shapes, [a.id], ['outer'], []);
    expect(shapes.map((s) => s.id)).toEqual([below.id, above.id, a.id]);
    expect(a.groups).toEqual([]);
  });
  it('reparents whole nested units above destination children without changing artwork', () => {
    const a = { ...shape(), groups: ['source', 'unit', 'inner'] },
      b = { ...shape(), groups: ['source', 'unit'] },
      c = { ...shape(), groups: ['source'] },
      d = { ...shape(), groups: ['target', 'child'] },
      outside = shape();
    a.transform = [1, 0.2, 0.3, 1];
    a.pivot = { x: 17, y: -20 };
    const shapes = [a, b, c, d, outside],
      before = clone(shapes);
    expect(reparentVectors(shapes, [a.id], ['source'], ['target'])).toEqual([a.id, b.id]);
    expect(shapes.map((s) => s.id)).toEqual([c.id, d.id, a.id, b.id, outside.id]);
    expect(a.groups).toEqual(['target', 'unit', 'inner']);
    expect(b.groups).toEqual(['target', 'unit']);
    for (const original of before) {
      const actual = shapes.find((s) => s.id === original.id)!;
      expect({ ...actual, groups: original.groups }).toEqual(original);
    }
    const p = newProject();
    p.layers[0].keys[0].shapes = shapes;
    expect(validateProject(p)).toEqual(p);
    reparentVectors(shapes, [a.id], ['target'], []);
    expect(a.groups).toEqual(['unit', 'inner']);
    expect(shapes.slice(-2)).toEqual([a, b]);
    expect(validateProject(p)).toEqual(p);
  });
  it('moves leaves out of isolation and treats same-scope moves as exact no-ops', () => {
    const a = { ...shape(), groups: ['outer', 'inner'] },
      b = { ...shape(), groups: ['outer'] };
    const shapes = [a, b],
      before = clone(shapes);
    reparentVectors(shapes, [a.id], ['outer', 'inner'], ['outer', 'inner']);
    expect(shapes).toEqual(before);
    reparentVectors(shapes, [a.id], ['outer', 'inner'], ['outer']);
    expect(a.groups).toEqual(['outer']);
    expect(shapes).toEqual([b, a]);
  });
  it('rejects cycles, stale scopes/selections, malformed stacks and depth overflow atomically', () => {
    const a = { ...shape(), groups: ['unit', 'inner'] },
      b = { ...shape(), groups: ['target'] };
    const shapes = [a, b];
    for (const action of [
      () => reparentVectors(shapes, [a.id], [], ['unit', 'inner']),
      () => reparentVectors(shapes, [a.id], [], ['missing']),
      () => reparentVectors(shapes, [a.id], ['target'], []),
      () => reparentVectors(shapes, ['missing'], [], []),
    ]) {
      const before = clone(shapes);
      expect(action).toThrow();
      expect(shapes).toEqual(before);
    }
    b.groups = Array.from({ length: 32 }, (_, i) => `depth${i}`);
    const before = clone(shapes);
    expect(() => reparentVectors(shapes, [a.id], [], b.groups)).toThrow('32');
    expect(shapes).toEqual(before);
    shapes.push({ ...shape(), groups: ['unit'] });
    const split = clone(shapes);
    expect(() => reparentVectors(shapes, [a.id], [], [])).toThrow('stacking');
    expect(shapes).toEqual(split);
  });
  it('rejects split stacking units and groups inside merge layers', () => {
    const p = newProject(),
      shapes = p.layers[0].keys[0].shapes;
    const group = id();
    shapes.push({ ...shape(), groups: [group] }, shape(), { ...shape(), groups: [group] });
    expect(() => validateProject(p)).toThrow('group stacking');
    shapes.splice(1, 1);
    p.layers[0].drawingMode = 'merge';
    expect(() => validateProject(p)).toThrow('groups require object drawing');
  });
  it('makes a contiguous stacking unit and expands partial selection without altering geometry', () => {
    const a = shape(),
      b = shape(),
      c = shape(),
      shapes = [a, b, c];
    groupVectors(shapes, [a.id, c.id], []);
    expect(shapes.map((s) => s.id)).toEqual([b.id, a.id, c.id]);
    expect(a.groups).toEqual(c.groups);
    expect(a.x).toBe(10);
    expect(expandSelection(shapes, [a.id], [])).toEqual([a.id, c.id]);
    expect(expandSelection(shapes, [a.id], a.groups!)).toEqual([a.id]);
  });
  it('nests groups, ungroups one level, and remaps copied group identities consistently', () => {
    const shapes = [shape(), shape(), shape()];
    groupVectors(
      shapes,
      shapes.slice(0, 2).map((s) => s.id),
      [],
    );
    const inner = shapes[0].groups![0];
    groupVectors(
      shapes,
      shapes.map((s) => s.id),
      [],
    );
    const outer = shapes[0].groups![0];
    expect(shapes[0].groups).toEqual([outer, inner]);
    const copy = copyVectors(shapes, 0);
    expect(copy[0].groups![0]).toBe(copy[2].groups![0]);
    expect(copy[0].groups![1]).toBe(copy[1].groups![1]);
    expect(copy[0].groups![0]).not.toBe(outer);
    expect(copy[0].id).not.toBe(shapes[0].id);
    ungroupVectors(
      shapes,
      shapes.map((s) => s.id),
      [],
    );
    expect(shapes[0].groups).toEqual([inner]);
    expect(shapes[2].groups).toEqual([]);
  });
  it('copies out of isolation without retaining the old parent and validates ancestry', () => {
    const p = newProject(),
      shapes = p.layers[0].keys[0].shapes;
    shapes.push(shape(), shape());
    groupVectors(
      shapes,
      shapes.map((s) => s.id),
      [],
    );
    const scope = shapes[0].groups!;
    expect(inScope(shapes[0], scope)).toBe(true);
    expect(copyVectors([shapes[0]], 1)[0].groups).toEqual([]);
    expect(validateProject(clone(p))).toEqual(p);
    shapes[1].groups = [id(), scope[0]];
    expect(() => validateProject(p)).toThrow('group parent');
    shapes[1].groups = [scope[0], scope[0]];
    expect(() => validateProject(p)).toThrow('group ancestry');
  });
  it('copies in place with independent nested group identities and unchanged source', () => {
    const a = shape(),
      b = shape();
    a.groups = ['outer', 'inner'];
    b.groups = ['outer', 'inner'];
    a.transform = [1, 0.2, 0.3, 1];
    const before = clone([a, b]);
    const copies = copyVectors([a, b], 1, ['target'], { x: 0, y: 0 });
    expect(copies.map((s) => [s.x, s.y])).toEqual(before.map((s) => [s.x, s.y]));
    expect(copies[0].transform).toEqual(a.transform);
    expect(copies[0].groups![0]).toBe('target');
    expect(copies[0].groups![1]).toBe(copies[1].groups![1]);
    expect(copies[0].groups![1]).not.toBe('inner');
    expect([a, b]).toEqual(before);
  });
});
