import { it, expect } from 'vitest';
import { newProject, newLayer, clone, keyAt, validateProject } from '../packages/document/src';
import { transferFrameBlock, transferFrameTracks } from '../packages/animation/src/timeline';
function fixture() {
  const p = newProject();
  p.duration = 12;
  p.layers = Array.from({ length: 3 }, (_, i) => {
    const l = newLayer('Layer ' + i);
    l.id = 'l' + i;
    l.keys = [0, 2, 4, 6].map((frame) => ({
      frame,
      shapes: [
        {
          id: `s${i}-${frame}`,
          kind: 'rectangle' as const,
          x: i * 100 + frame,
          y: 0,
          width: 10,
          height: 10,
          rotation: 0,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 0,
          points: [],
        },
      ],
    }));
    return l;
  });
  return p;
}
for (const copy of [false, true])
  for (const at of [0, 3, 8])
    it(`transfers vertically overlapping tracks at ${at}, copy=${copy}, from original snapshots`, () => {
      const p = fixture(),
        before = clone(p);
      transferFrameBlock(
        p,
        [
          { sourceId: 'l0', targetId: 'l1' },
          { sourceId: 'l1', targetId: 'l2' },
        ],
        2,
        4,
        at,
        copy,
      );
      expect(keyAt(p.layers[1], at).shapes[0].x).toBe(2);
      expect(keyAt(p.layers[2], at).shapes[0].x).toBe(102);
      validateProject(p);
      if (copy) expect(p.layers[0]).toEqual(before.layers[0]);
      else if (at > 4) expect(keyAt(p.layers[0], 2)).toEqual(before.layers[0].keys[0]);
    });
for (const copy of [false, true])
  it(`supports same-layer time shifts copy=${copy} without source/destination aliasing`, () => {
    const p = fixture();
    transferFrameBlock(p, [{ sourceId: 'l0', targetId: 'l0' }], 2, 4, 3, copy);
    expect(keyAt(p.layers[0], 3).shapes[0].x).toBe(2);
    if (!copy) expect(keyAt(p.layers[0], 3).shapes[0].id).toBe('s0-2');
    expect(keyAt(p.layers[0], 5).shapes[0].x).toBe(4);
    validateProject(p);
  });
for (const invalid of ['locked', 'mode', 'duplicate', 'overflow'])
  it(`rejects ${invalid} atomically`, () => {
    const p = fixture();
    if (invalid === 'locked') p.layers[2].locked = true;
    if (invalid === 'mode') {
      p.layers[1].drawingMode = 'object';
      p.layers[1].keys[1].shapes[0].groups = ['group'];
      p.layers[2].drawingMode = 'merge';
    }
    const before = clone(p);
    expect(() =>
      transferFrameBlock(
        p,
        [
          { sourceId: 'l0', targetId: 'l1' },
          { sourceId: 'l1', targetId: invalid === 'duplicate' ? 'l1' : 'l2' },
        ],
        2,
        4,
        invalid === 'overflow' ? 100000 : 8,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  });
it('retains the legacy explicit transfer restriction', () => {
  const p = fixture();
  expect(() =>
    transferFrameTracks(
      p,
      [
        { sourceId: 'l0', targetId: 'l1' },
        { sourceId: 'l1', targetId: 'l2' },
      ],
      2,
      4,
      8,
      'move',
    ),
  ).toThrow(/separate/);
});
