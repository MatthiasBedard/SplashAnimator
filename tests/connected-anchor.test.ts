import { expect, it, vi } from 'vitest';
import { connectedAnchorSets, prepareAnchorSetEdit } from '../apps/editor/src/subselection';
import { connectedLines, connectedWorldNodes } from './connected-anchor-fixture';
import { matrix, inversePoint } from '../packages/geometry/src/affine';
import { captureAttachedFillEdit } from '../packages/geometry/src/attached-fill';
import { type Vector } from '../packages/document/src';
import { mergeVectors } from '../packages/geometry/src/merge';

for (const merged of [false, true])
  it(`moves every original branch of a ${merged ? 'genuine merged' : 'stored'} junction without new vertices`, () => {
    const lines = connectedLines(merged),
      before = structuredClone(lines),
      pick = lines.flatMap((s) =>
        connectedWorldNodes(s).flatMap((p, i) =>
          Math.hypot(p.x - 200, p.y - 120) < 1e-8 ? [{ id: s.id, index: i }] : [],
        ),
      )[0];
    const sets = connectedAnchorSets(lines, { [pick.id]: [pick.index] }),
      edits = prepareAnchorSetEdit(lines, sets, { x: 30, y: -20 });
    expect(Object.keys(sets)).toHaveLength(3);
    for (const s of lines) {
      const original = connectedWorldNodes(s),
        out = connectedWorldNodes(edits.find((e) => e.id === s.id)!);
      expect(out).toHaveLength(original.length);
      original.forEach((p, i) => {
        const joined = Math.hypot(p.x - 200, p.y - 120) < 1e-8;
        for (const role of ['anchor', 'in', 'out'] as const) {
          const a = role === 'anchor' ? p : p[role],
            b = role === 'anchor' ? out[i] : out[i][role];
          if (!a) {
            expect(b).toBeUndefined();
            continue;
          }
          expect(b!.x).toBeCloseTo(a.x + (joined ? 30 : 0), 8);
          expect(b!.y).toBeCloseTo(a.y - (joined ? 20 : 0), 8);
        }
      });
      expect({ ...edits.find((e) => e.id === s.id), nodes: undefined }).toEqual({
        ...s,
        nodes: undefined,
      });
    }
    expect(lines).toEqual(before);
  });
it('maps joined anchors and their handles through distinct skewed and reflected original bases', () => {
  const lines = connectedLines(),
    before = lines.map(connectedWorldNodes);
  for (const [i, s] of lines.entries()) {
    const world = connectedWorldNodes(s);
    s.transform = i === 1 ? [-1, 0.2, 0.3, 1] : [1, 0.2, -0.3, 1];
    s.x = 70 + i * 20;
    s.y = 35 + i * 10;
    const m = matrix(s);
    s.nodes = world.map((n) => ({
      ...inversePoint(m, n),
      ...(n.in ? { in: inversePoint(m, n.in) } : {}),
      ...(n.out ? { out: inversePoint(m, n.out) } : {}),
    }));
  }
  const sets = connectedAnchorSets(lines, { branch: [0] }),
    out = prepareAnchorSetEdit(lines, sets, { x: 11, y: -7 });
  expect(Object.keys(sets)).toHaveLength(3);
  for (const s of out) {
    const i = lines.findIndex((source) => source.id === s.id);
    const nodes = connectedWorldNodes(s);
    before[i].forEach((n, j) => {
      const joined = Math.hypot(n.x - 200, n.y - 120) < 1e-8;
      for (const role of ['anchor', 'in', 'out'] as const) {
        const a = role === 'anchor' ? n : n[role],
          b = role === 'anchor' ? nodes[j] : nodes[j][role];
        if (!a) {
          expect(b).toBeUndefined();
          continue;
        }
        expect(b!.x).toBeCloseTo(a.x + (joined ? 11 : 0), 8);
        expect(b!.y).toBeCloseTo(a.y - (joined ? 7 : 0), 8);
      }
    });
  }
});

it('keeps the actual arrangement junction created where a new branch ends inside an existing line', () => {
  const source = connectedLines(),
    horizontal: Vector = {
      ...source[0],
      id: 'horizontal',
      width: 240,
      nodes: [
        { x: 0, y: 0 },
        { x: 240, y: 0 },
      ],
    },
    artwork = mergeVectors([horizontal, source[2]], undefined, true),
    points = artwork.flatMap((s) =>
      connectedWorldNodes(s).flatMap((p, index) =>
        Math.hypot(p.x - 200, p.y - 120) < 1e-8 ? [{ owner: s.id, index }] : [],
      ),
    );
  expect(points.length).toBeGreaterThanOrEqual(2);
  const sets = connectedAnchorSets(artwork, { [points[0].owner]: [points[0].index] }),
    edits = prepareAnchorSetEdit(artwork, sets, { x: 10, y: -20 });
  for (const p of points)
    expect(connectedWorldNodes(edits.find((s) => s.id === p.owner)!)[p.index]).toMatchObject({
      x: 210,
      y: 100,
    });
});
it('keeps object-mode, different-group and nearby unjoined vertices independent', () => {
  const lines = connectedLines();
  lines.push(
    { ...structuredClone(lines[2]), id: 'object', drawingMode: 'object' },
    { ...structuredClone(lines[2]), id: 'group', groups: ['other'] },
    { ...structuredClone(lines[2]), id: 'near', x: 200.001 },
  );
  expect(connectedAnchorSets(lines, { branch: [0] })).toEqual({
    branch: [0],
    left: [1],
    right: [0],
  });
  lines[2].drawingMode = 'object';
  expect(connectedAnchorSets(lines, { branch: [0] }, true)).toEqual({ branch: [0] });
});
it('admits unmarked strokes only within an explicit merged main layer', () => {
  const lines = connectedLines();
  for (const s of lines) delete s.drawingMode;
  expect(connectedAnchorSets(lines, { branch: [0] })).toEqual({ branch: [0] });
  expect(Object.keys(connectedAnchorSets(lines, { branch: [0] }, true))).toHaveLength(3);
});
it('preserves a second explicit pick and joins duplicate anchors within the same merged path', () => {
  const lines = connectedLines();
  lines[2].closed = true;
  lines[2].nodes!.push({ ...structuredClone(lines[2].nodes![0]) });
  expect(connectedAnchorSets(lines, { branch: [0], right: [1] })).toEqual({
    branch: [0, 2],
    right: [1, 0],
    left: [1],
  });
});
it('does not transitively attach a chain of numerically nearby original anchors', () => {
  const lines = connectedLines();
  for (const s of lines) s.x += 1000000;
  const epsilon = 1000200 * Number.EPSILON * 64;
  lines[1].x += epsilon * 0.8;
  lines[2].x += epsilon * 1.6;
  const sets = connectedAnchorSets(lines, { left: [1] });
  expect(sets.right).toEqual([0]);
  expect(sets.branch).toBeUndefined();
});
it('large origins do not widen original matching into document-unit snapping', () => {
  const lines = connectedLines();
  for (const s of lines) {
    s.x += 1e14;
    s.y += 1e14;
  }
  lines[1].x += 1;
  const sets = connectedAnchorSets(lines, { branch: [0] });
  expect(sets.left).toEqual([1]);
  expect(sets.right).toBeUndefined();
});
it('returns detached sets and exact original geometry for no-op preparation', () => {
  const lines = connectedLines(),
    before = structuredClone(lines),
    picks = { branch: [0] },
    sets = connectedAnchorSets(lines, picks),
    out = prepareAnchorSetEdit(lines, sets, { x: 0, y: 0 });
  for (const s of out) expect(s).toEqual(lines.find((original) => original.id === s.id));
  sets.branch.push(1);
  expect(picks).toEqual({ branch: [0] });
  out[0].nodes![0].x = 999;
  expect(lines).toEqual(before);
});
it('all moved branch sources continue to carry attached fill corners atomically', () => {
  const lines = connectedLines(),
    fill: Vector = {
      ...structuredClone(lines[0]),
      id: 'fill',
      kind: 'polygon',
      x: 200,
      y: 120,
      width: 100,
      height: 80,
      strokeWidth: 0,
      fill: '#ff0000',
      fillEnabled: true,
      nodes: undefined,
      closed: true,
      fillRule: 'evenodd',
      contours: [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 80 },
          { x: 0, y: 80 },
        ],
      ],
    },
    artwork = [...lines, fill],
    sets = connectedAnchorSets(artwork, { branch: [0] }),
    attached = captureAttachedFillEdit(artwork, Object.keys(sets)),
    edited = prepareAnchorSetEdit(artwork, sets, { x: 20, y: -10 }),
    paint = attached.prepare(edited).find((s) => s.id === 'fill')!;
  expect(connectedWorldNodes(paint)[0]).toMatchObject({ x: 220, y: 110 });
  expect(paint.contours![0]).toHaveLength(4);
  expect(connectedWorldNodes(paint)[1]).toMatchObject({ x: 300, y: 120 });
});
it('rejects missing, numeric and getter-owned anchors before any source write', () => {
  const lines = connectedLines(),
    before = structuredClone(lines);
  expect(() => connectedAnchorSets(lines, { missing: [0] })).toThrow();
  expect(() => connectedAnchorSets(lines, { left: [NaN] })).toThrow();
  expect(() => connectedAnchorSets(lines, { left: [99] })).toThrow();
  const getter = vi.fn(() => 0);
  Object.defineProperty(lines[0].nodes![0], 'x', { get: getter, enumerable: true });
  expect(() => connectedAnchorSets(lines, { branch: [0] })).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(before[0].nodes![0].x).toBe(0);
});
it('a singular later branch rejects the complete edit without mutating valid earlier branches', () => {
  const lines = connectedLines();
  lines[2].transform = [0, 0, 0, 1];
  const before = structuredClone(lines),
    sets = connectedAnchorSets(lines, { left: [1] });
  expect(() => prepareAnchorSetEdit(lines, sets, { x: 10, y: 10 })).toThrow();
  expect(lines).toEqual(before);
});

it('ignores empty cross-artwork entries so unselected fills remain attachment targets', () => {
  const lines = connectedLines(),
    fill: Vector = {
      ...structuredClone(lines[0]),
      id: 'fill',
      kind: 'polygon',
      strokeWidth: 0,
      fillEnabled: true,
      closed: true,
      fillRule: 'evenodd',
      nodes: undefined,
      contours: [
        [
          { x: 0, y: 0 },
          { x: 140, y: 0 },
          { x: 140, y: 80 },
          { x: 0, y: 80 },
        ],
      ],
    };
  const sets = connectedAnchorSets([...lines, fill], {
    left: [],
    right: [],
    branch: [0],
    fill: [],
  });
  expect(sets).toEqual({ branch: [0], left: [1], right: [0] });
  expect(connectedAnchorSets([...lines, fill], { left: [], fill: [] })).toEqual({});
});
