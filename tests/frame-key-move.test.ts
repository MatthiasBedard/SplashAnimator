import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  newLayer,
  clone,
  validateProject,
  type Project,
} from '../packages/document/src';
import { relocateFrameKeys, transferFrameBlock } from '../packages/animation/src/timeline';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const p = newProject();
  p.duration = 12;
  p.layers = Array.from({ length: 3 }, (_, i) => ({
    ...newLayer('Track ' + i),
    id: 'l' + i,
    keys: [0, 2, 4, 6].map((frame) => ({
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
    })),
  }));
  return p;
}
const keys = (p: Project, row = 0) => p.layers[row].keys.map((k) => k.frame);
it.each([0, 1, 3, 8])(
  'relocates existing keys to %s without boundary keys, shifting outside keys or inserting time',
  (at) => {
    const p = fixture(),
      before = clone(p),
      incoming = before.layers[0].keys
        .filter((k) => k.frame >= 2 && k.frame <= 4)
        .map((k) => ({ ...k, frame: k.frame + at - 2 }));
    relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 2, 4, at);
    const expected = [
      ...before.layers[0].keys.filter(
        (k) => (k.frame < 2 || k.frame > 4) && (k.frame < at || k.frame >= at + 3),
      ),
      ...incoming,
    ].sort((a, b) => a.frame - b.frame);
    if (!expected.some((k) => k.frame === 0)) expected.unshift({ frame: 0, shapes: [] });
    expect(p.layers[0].keys).toEqual(expected);
    expect(p.layers.slice(1)).toEqual(before.layers.slice(1));
    expect(p.duration).toBe(12);
    validateProject(p);
  },
);
it('a single moved key creates neither a blank source key nor a restored destination tail', () => {
  const p = fixture();
  relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 2, 2, 8);
  expect(keys(p)).toEqual([0, 4, 6, 8]);
  expect(p.layers[0].keys.find((k) => k.frame === 8)!.shapes[0].id).toBe('s0-2');
});
it('moving frame zero adds only the required initial blank and retains every other original key', () => {
  const p = fixture(),
    before = clone(p);
  relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 0, 0, 8);
  expect(p.layers[0].keys).toEqual([
    { frame: 0, shapes: [] },
    ...before.layers[0].keys.slice(1),
    { ...before.layers[0].keys[0], frame: 8 },
  ]);
  expect(p.duration).toBe(12);
});
it('a held-only selection is a no-op and a held range start does not invent a destination key', () => {
  const p = fixture(),
    before = clone(p);
  expect(relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 3, 3, 8)).toBe(false);
  expect(p).toEqual(before);
  relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 3, 4, 8);
  expect(keys(p)).toEqual([0, 2, 6, 9]);
  expect(p.layers[0].keys.at(-1)!.shapes[0].id).toBe('s0-4');
});
it('captures vertically and temporally overlapping source rows before any destination replacement', () => {
  const p = fixture(),
    before = clone(p);
  relocateFrameKeys(
    p,
    [
      { sourceId: 'l0', targetId: 'l1' },
      { sourceId: 'l1', targetId: 'l2' },
    ],
    2,
    4,
    3,
  );
  expect(keys(p, 0)).toEqual([0, 6]);
  expect(keys(p, 1)).toEqual([0, 3, 5, 6]);
  expect(keys(p, 2)).toEqual([0, 2, 3, 5, 6]);
  expect(p.layers[1].keys.find((k) => k.frame === 3)!.shapes[0].x).toBe(2);
  expect(p.layers[2].keys.find((k) => k.frame === 3)!.shapes[0].x).toBe(102);
  expect(p.layers[2].keys.find((k) => k.frame === 6)).toEqual(
    before.layers[2].keys.find((k) => k.frame === 6),
  );
  expect(p.layers[1].keys.find((k) => k.frame === 3)!.shapes[0].id).not.toBe('s0-2');
  validateProject(p);
});
it('replaces the complete destination rectangle including off-offset keys, without boundary duplication', () => {
  const p = fixture();
  p.layers[1].keys.push({
    frame: 9,
    shapes: [{ ...p.layers[1].keys[0].shapes[0], id: 'destination-nine' }],
  });
  relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l1' }], 2, 4, 8);
  expect(keys(p, 0)).toEqual([0, 6]);
  expect(keys(p, 1)).toEqual([0, 2, 4, 6, 8, 10]);
  expect(p.layers[1].keys.flatMap((k) => k.shapes).some((s) => s.id === 'destination-nine')).toBe(
    false,
  );
});
it('extends only timeline capacity when dropped beyond the old end, without blank padding keys', () => {
  const p = fixture();
  relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 2, 4, 20);
  expect(p.duration).toBe(23);
  expect(keys(p)).toEqual([0, 6, 20, 22]);
  validateProject(p);
});
it('same-position moves preserve exact optional metadata and no-op state', () => {
  const p = fixture();
  p.layers[0].motionSpans = [];
  const before = clone(p);
  expect(relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 2, 4, 2)).toBe(false);
  expect(p).toEqual(before);
  relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 2, 2, 8);
  expect(p.layers[0].motionSpans).toEqual([]);
});
function motionFixture() {
  const p = fixture(),
    s = p.layers[0].keys[0].shapes[0];
  p.layers[0].keys = [0, 4, 6].map((frame) => ({ frame, shapes: [{ ...s, x: frame * 10 }] }));
  createBasicMotionSpan(p, ['l0'], 0, 4, 'linear');
  return p;
}
it('copies remembered motion into occupied frames without changing the source or outside keys', () => {
  const p = motionFixture(), before = clone(p);
  transferFrameBlock(p, [{ sourceId: 'l0', targetId: 'l1' }], 0, 4, 2, true);
  const layer = p.layers[1], span = layer.motionSpans![0];
  expect(p.layers[0]).toEqual(before.layers[0]);
  expect(p.duration).toBe(before.duration);
  expect(layer.keys.map(key => key.frame)).toEqual([0, 2, 3, 4, 5, 6]);
  expect(layer.keys[0]).toEqual(before.layers[1].keys[0]);
  expect(span).toMatchObject({ start: 2, end: 6, ease: 'linear' });
  expect(span.id).not.toBe(before.layers[0].motionSpans![0].id);
  expect(JSON.parse(span.baseline)).toEqual(layer.keys.slice(2, 5));
  expect(layer.keys.slice(1).map(key => key.shapes[0].x)).toEqual([0, 10, 20, 30, 40]);
});
it.each(['l0', 'l1'])(
  'moves a complete remembered recipe to %s with exact generated ownership and no boundary keys',
  (targetId) => {
    const p = motionFixture(),
      before = clone(p),
      span = clone(p.layers[0].motionSpans![0]);
    relocateFrameKeys(p, [{ sourceId: 'l0', targetId }], 0, 4, 6);
    const target = p.layers.find((l) => l.id === targetId)!;
    expect(target.motionSpans![0]).toMatchObject({
      ...span,
      start: 6,
      end: 10,
      baseline: target.motionSpans![0].baseline,
    });
    expect(JSON.parse(target.motionSpans![0].baseline)).toEqual(
      target.keys.filter((k) => k.frame > 6 && k.frame < 10),
    );
    expect(target.keys.map((k) => k.frame)).not.toContain(11);
    expect(p.layers[0].keys[0]).toEqual({ frame: 0, shapes: [] });
    expect(p.symbols).toEqual(before.symbols);
    validateProject(p);
  },
);
it('replaces a complete destination remembered span together with its replaced keys', () => {
  const p = motionFixture();
  [p.layers[0], p.layers[1]] = [p.layers[1], p.layers[0]];
  relocateFrameKeys(p, [{ sourceId: 'l1', targetId: 'l0' }], 2, 6, 0);
  expect(p.layers.find((l) => l.id === 'l0')!.motionSpans).toBeUndefined();
  expect(p.layers.find((l) => l.id === 'l0')!.keys.map((k) => k.frame)).toEqual([0, 2, 4, 6]);
  validateProject(p);
});
it.each(['source', 'destination'])(
  'rejects a partial %s remembered span before any key is edited',
  (where) => {
    const p = motionFixture(),
      before = clone(p);
    expect(() =>
      relocateFrameKeys(
        p,
        [{ sourceId: where === 'source' ? 'l0' : 'l1', targetId: 'l0' }],
        2,
        2,
        where === 'source' ? 8 : 2,
      ),
    ).toThrow(/complete|part/);
    expect(p).toEqual(before);
  },
);
it('keeps saved masks, affine paint, symbol playback and unselected layer options exact', () => {
  const p = fixture(),
    s = p.layers[0].keys[1].shapes[0];
  p.symbols = [
    {
      id: 'graphic',
      name: 'Graphic',
      width: 10,
      height: 10,
      shapes: [clone(s)],
      timeline: { duration: 3, keys: [] },
    },
  ];
  Object.assign(s, {
    kind: 'symbol',
    symbolId: 'graphic',
    symbolPlayback: { mode: 'loop', firstFrame: 1 },
    transform: [-1, 0.2, 0.4, 1],
    pivot: { x: 2, y: 3 },
    opacity: 0.5,
  });
  p.layerMasks = [{ maskLayerId: 'l2', layerIds: ['l0', 'l1'] }];
  const before = clone(p);
  relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 2, 2, 8);
  expect(p.layers[0].keys.at(-1)!.shapes).toEqual(before.layers[0].keys[1].shapes);
  expect(p.layerMasks).toEqual(before.layerMasks);
  expect(p.symbols).toEqual(before.symbols);
  expect(p.layers.slice(1)).toEqual(before.layers.slice(1));
});
it.each([
  'locked',
  'missing',
  'mode',
  'duplicates',
  'negative',
  'fraction',
  'nan',
  'overflow',
  'range',
])('rejects %s atomically', (mode) => {
  const p = fixture();
  if (mode === 'locked') p.layers[1].locked = true;
  if (mode === 'mode') {
    p.layers[1].drawingMode = 'merge';
    const shapes = p.layers[0].keys[1].shapes;
    shapes[0].groups = ['group'];
    shapes.push({ ...clone(shapes[0]), id: 'group-member', x: 30 });
  }
  const before = clone(p);
  const mappings = [{ sourceId: 'l0', targetId: mode === 'missing' ? 'missing' : 'l1' }];
  if (mode === 'duplicates') mappings.push({ sourceId: 'l2', targetId: 'l1' });
  expect(() =>
    relocateFrameKeys(
      p,
      mappings,
      mode === 'range' ? 12 : 2,
      mode === 'range' ? 13 : 4,
      mode === 'negative'
        ? -1
        : mode === 'fraction'
          ? 1.5
          : mode === 'nan'
            ? NaN
            : mode === 'overflow'
              ? 99999
              : 8,
    ),
  ).toThrow();
  expect(p).toEqual(before);
});
it('rejects raw accessors without invoking them', () => {
  const p = fixture(),
    before = clone(p);
  let reads = 0;
  const mapping = {
    sourceId: 'l0',
    get targetId() {
      reads++;
      return 'l1';
    },
  };
  expect(() => relocateFrameKeys(p, [mapping], 2, 4, 8)).toThrow();
  expect(reads).toBe(0);
  expect(p).toEqual(before);
});

it('rejects original project accessors before reading range or clone data', () => {
  const p = fixture(),
    before = clone(p);
  let reads = 0;
  Object.defineProperty(p, 'duration', {
    enumerable: true,
    get() {
      reads++;
      return 12;
    },
  });
  expect(() => relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l1' }], 2, 4, 8)).toThrow();
  expect(reads).toBe(0);
  expect(p.layers).toEqual(before.layers);
});

it('rejects original nonfinite artwork without normalizing it through JSON', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].opacity = NaN;
  expect(() => relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l1' }], 2, 4, 8)).toThrow();
  expect(p.layers[0].keys[1].shapes[0].opacity).toBeNaN();
  expect(keys(p)).toEqual([0, 2, 4, 6]);
});

it('a same-time row permutation fills frame zero from the incoming source without adding blanks', () => {
  const p = fixture(),
    before = clone(p);
  relocateFrameKeys(
    p,
    [
      { sourceId: 'l0', targetId: 'l1' },
      { sourceId: 'l1', targetId: 'l0' },
    ],
    0,
    0,
    0,
  );
  for (const row of [0, 1]) expect(keys(p, row)).toEqual([0, 2, 4, 6]);
  expect(p.layers[0].keys[0].shapes[0].x).toBe(100);
  expect(p.layers[1].keys[0].shapes[0].x).toBe(0);
  expect(p.layers[0].keys.slice(1)).toEqual(before.layers[0].keys.slice(1));
  expect(p.layers[1].keys.slice(1)).toEqual(before.layers[1].keys.slice(1));
});

it('rejects a move that would remove an absolute opacity target from its saved interval', () => {
  const p = fixture();
  p.opacityBindings = [
    { layerId: 'l0', shapeId: 's0-2', start: 2, end: 3, keys: [{ frame: 2, opacity: 0.5 }] },
  ];
  validateProject(p);
  const before = clone(p);
  expect(() => relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l0' }], 2, 2, 8)).toThrow();
  expect(p).toEqual(before);
});
it('rejects an actual clone-time source edit while preserving that independent edit', () => {
  const p = fixture(),
    parse = JSON.parse;
  let edited = false;
  vi.spyOn(JSON, 'parse').mockImplementation((...args: Parameters<typeof JSON.parse>) => {
    const value = parse(...args);
    if (!edited && value?.schemaVersion) {
      edited = true;
      p.layers[2].name = 'User edit';
    }
    return value;
  });
  expect(() => relocateFrameKeys(p, [{ sourceId: 'l0', targetId: 'l1' }], 2, 4, 8)).toThrow(
    /changed/,
  );
  expect(edited).toBe(true);
  const expected = fixture();
  expected.id = p.id;
  expected.name = p.name;
  expected.layers[2].name = 'User edit';
  expect(p.layers).toEqual(expected.layers);
});
