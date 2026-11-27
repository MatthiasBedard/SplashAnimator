import { expect, it, vi } from 'vitest';
import { validateProject, migrateProject, type Project } from '../packages/document/src';
import { liveSplitFixture as fixture } from './live-motion-split-fixture';
import {
  captureLiveMotionAuthoringFrame as capture,
  prepareSplitLiveMotionSpans as split,
} from '../packages/animation/src/live-motion-owner';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';

function operation(p: Project, frame = 4) {
  const view = capture(() => ({ project: p, revision: 7, frame }));
  return { view, requests: [{ owner: view.resolve('track', 'art'), rightSpanId: 'right' }] };
}
function equivalent(a: Project, b: Project) {
  const av = captureLiveMotionTimeline(() => ({ project: a, revision: 0 })),
    bv = captureLiveMotionTimeline(() => ({ project: b, revision: 0 }));
  try {
    for (let f = 0; f < a.duration; f++) {
      const x = av.sample(f),
        y = bv.sample(f);
      expect(y.map((t) => t.layerId)).toEqual(x.map((t) => t.layerId));
      x.forEach((t, i) =>
        expect(sameMotionArtwork(t.key.shapes, y[i].key.shapes), `frame ${f}`).toBe(true),
      );
    }
  } finally {
    av.dispose();
    bv.dispose();
  }
}
it('promotes exactly one complete shared key, retains IDs/endpoints/settings and writes no source', () => {
  const p = fixture((p) => {
      for (const k of p.layers[0].keys.slice(0, 2))
        k.shapes.push({ ...structuredClone(k.shapes[0]), id: 'second', y: 45 });
    }),
    before = structuredClone(p),
    { view, requests } = operation(p);
  const out = split(requests);
  validateProject(out);
  expect(p).toEqual(before);
  expect(requests[0].owner.shapeIds).toEqual(['art', 'second']);
  expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
  expect(out.layers[0].keys[1].shapes).toEqual(view.scene[0].key.shapes);
  expect(out.layers[0].liveMotionSpans).toEqual([
    { id: 'live', start: 0, end: 4, ease: 'linear' },
    { id: 'right', start: 4, end: 8, ease: 'linear' },
  ]);
  expect(out.layers[0].motionSpans).toBeUndefined();
  for (const k of before.layers[0].keys)
    expect(out.layers[0].keys.find((v) => v.frame === k.frame)).toEqual(k);
  expect({ ...out, layers: [] }).toEqual({ ...before, layers: [] });
  equivalent(p, out);
  out.layers[0].keys[0].shapes[0].x = 100;
  expect(p).toEqual(before);
  view.dispose();
});
for (const ease of [
  'linear',
  'in',
  'out',
  'in-out',
  { kind: 'cubic', x1: 1 / 3, y1: 1 / 6, x2: 2 / 3, y2: 2 / 3 },
] as const)
  it(`preserves ${JSON.stringify(ease)} geometry through JSON reopen`, () => {
    const p = fixture((_p, s) => {
        s.ease = ease;
      }),
      { view, requests } = operation(p),
      out = split(requests);
    equivalent(p, out);
    equivalent(p, migrateProject(JSON.parse(JSON.stringify(out))));
    view.dispose();
  });
for (const frame of [2, 6])
  for (const ease of ['linear', 'in', 'out'] as const)
    it(`preserves ${ease} at unequal cut ${frame}`, () => {
      const p = fixture((_p, s) => (s.ease = ease)),
        { view, requests } = operation(p, frame);
      equivalent(p, split(requests));
      view.dispose();
    });
it('restricts independent opacity and exact representable paint channels without enabling options', () => {
  const p = fixture((p, s) => {
      s.ease = 'in';
      s.opacityEase = 'out';
      s.paintEase = 'linear';
      s.options = { paint: true };
      p.layers[0].keys[0].shapes[0].opacity = 0;
      p.layers[0].keys[0].shapes[0].fill = '#000000';
      p.layers[0].keys[1].shapes[0].fill = '#808080';
    }),
    { view, requests } = operation(p),
    out = split(requests);
  equivalent(p, out);
  expect(out.layers[0].liveMotionSpans!.every((s) => s.options?.paint === true)).toBe(true);
  expect(out.layers[0].liveMotionSpans![0].paintEase).toBe('linear');
  view.dispose();
});
for (const reflected of [false, true])
  for (const kind of ['ellipse', 'bezier', 'polygon'] as const)
    it(`preserves ${reflected ? 'reflected' : 'affine'} ${kind} geometry and saved pivots`, () => {
      const p = fixture((p, s) => {
          s.options = { affine: true, pivots: true, nodes: kind !== 'ellipse' };
          for (const k of p.layers[0].keys.slice(0, 2)) {
            const a = k.shapes[0];
            a.kind = kind;
            a.transform = [reflected ? -2 : 2, 0.25, 0.5, 3];
            a.pivot = { x: 7, y: -3 };
            if (kind === 'bezier') {
              a.closed = false;
              a.nodes = [
                { x: 0, y: 0, out: { x: 5, y: 2 } },
                { x: 20, y: 20, in: { x: 17, y: 15 } },
              ];
            }
            if (kind === 'polygon') {
              a.fillRule = 'evenodd';
              a.contours = [
                [
                  { x: 0, y: 0 },
                  { x: 20, y: 0 },
                  { x: 20, y: 20 },
                  { x: 0, y: 20 },
                ],
                [
                  { x: 4, y: 4 },
                  { x: 7, y: 4 },
                  { x: 5, y: 7 },
                ],
              ];
            }
          }
        }),
        { view, requests } = operation(p);
      equivalent(p, split(requests));
      view.dispose();
    });
it('preserves original absent/saved pivot metadata and explicit default semantics', () => {
  const p = fixture((p, s) => {
      s.options = { affine: true, pivots: true, defaultPivots: true };
      p.layers[0].keys[1].shapes[0].pivot = { x: 2, y: 3 };
    }),
    { view, requests } = operation(p),
    out = split(requests);
  expect(Object.hasOwn(out.layers[0].keys[0].shapes[0], 'pivot')).toBe(false);
  expect(out.layers[0].keys[2]).toEqual(p.layers[0].keys[1]);
  equivalent(p, out);
  view.dispose();
});
it('preserves explicit omitted and own-undefined recipe metadata', () => {
  const p = fixture((_p, s) => {
      s.options = undefined;
      s.opacityEase = undefined;
    }),
    { view, requests } = operation(p),
    out = split(requests);
  for (const s of out.layers[0].liveMotionSpans!) {
    expect(Object.hasOwn(s, 'options')).toBe(true);
    expect(Object.hasOwn(s, 'opacityEase')).toBe(true);
    expect(Object.hasOwn(s, 'paintEase')).toBe(false);
  }
  view.dispose();
});
for (const tangent of [false, true])
  it(`restricts ${tangent ? 'tangent' : 'ordinary'} cubic path without baking`, () => {
    const p = fixture((_p, s) => {
        s.path = {
          startX: 24,
          startY: 32,
          endX: -24,
          endY: 32,
          ...(tangent ? { tangent: true } : {}),
        };
      }),
      { view, requests } = operation(p);
    equivalent(p, split(requests));
    view.dispose();
  });
for (const direction of ['clockwise', 'counterclockwise'] as const)
  it(`restricts shared ${direction} extra turns`, () => {
    const p = fixture((_p, s) => {
        s.rotation = { direction, turns: 2 };
      }),
      { view, requests } = operation(p),
      out = split(requests);
    equivalent(p, out);
    expect(out.layers[0].liveMotionSpans!.map((s) => s.rotation!.turns)).toEqual([1, 1]);
    view.dispose();
  });
it('keeps storage sparse over a longer proof interval', () => {
  const p = fixture((p, s) => {
      p.duration = 1025;
      p.layers[0].keys = p.layers[0].keys.slice(0, 2);
      p.layers[0].keys[1].frame = 1024;
      s.end = 1024;
    }),
    { view, requests } = operation(p, 512),
    out = split(requests);
  expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 512, 1024]);
  expect(out.layers[0].liveMotionSpans).toHaveLength(2);
  view.dispose();
});
it('does not trust detached public scenes/choices or copied owner metadata', () => {
  const p = fixture(),
    { view, requests } = operation(p),
    scene = view.scene;
  scene[0].key.shapes[0].x = 900;
  view.choices[0].shapeId = 'forged';
  expect(() => split([{ owner: { ...requests[0].owner }, rightSpanId: 'right' }])).toThrow(
    /private/,
  );
  expect(() => view.resolve('track', 'forged')).toThrow();
  expect(view.scene[0].key.shapes[0].x).toBe(48);
  equivalent(p, split(requests));
  expect(Object.isFrozen(requests[0].owner)).toBe(true);
  expect(Object.isFrozen(requests[0].owner.shapeIds)).toBe(true);
  view.dispose();
  expect(() => split(requests)).toThrow(/disposed/);
});
for (const frame of [0, 1, 7, 8, 9, 10])
  it(`offers no authoring owner at endpoint/hold/edge ${frame}`, () => {
    const p = fixture(),
      view = capture(() => ({ project: p, revision: 0, frame }));
    expect(view.choices).toEqual([]);
    expect(() => view.resolve('track', 'art')).toThrow();
    view.dispose();
  });
for (const field of ['locked', 'visible'] as const)
  it(`does not authorize ${field} track`, () => {
    const p = fixture();
    p.layers[0][field] = field === 'locked';
    const view = capture(() => ({ project: p, revision: 0, frame: 4 }));
    expect(view.choices).toEqual([]);
    view.dispose();
  });
for (const mutate of ['source', 'revision', 'frame', 'identity'] as const)
  it(`rejects stale ${mutate} ownership permanently`, () => {
    let p = fixture(),
      revision = 0,
      frame = 4;
    const view = capture(() => ({ project: p, revision, frame })),
      owner = view.resolve('track', 'art');
    if (mutate === 'source') p.layers[0].keys[1].shapes[0].x++;
    if (mutate === 'revision') revision++;
    if (mutate === 'frame') frame = 5;
    if (mutate === 'identity') p = structuredClone(p);
    expect(() => split([{ owner, rightSpanId: 'right' }])).toThrow();
    expect(() => view.scene).toThrow(/disposed/);
  });
for (const id of ['', 'live', undefined, 2])
  it(`rejects invalid/distinct right identity ${id}`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, requests } = operation(p);
    requests[0].rightSpanId = id as string;
    expect(() => split(requests)).toThrow();
    expect(p).toEqual(before);
    view.dispose();
  });
it('rejects raw input getters before invoking them and raw nonfinite values before cloning', () => {
  const p = fixture(),
    { view, requests } = operation(p),
    getter = vi.fn(() => requests[0].owner);
  expect(() =>
    split([
      {
        get owner() {
          return getter();
        },
        rightSpanId: 'right',
      },
    ]),
  ).toThrow(/data/);
  expect(getter).not.toHaveBeenCalled();
  expect(() => split([{ ...requests[0], rightSpanId: NaN as unknown as string }])).toThrow(
    /finite/,
  );
  view.dispose();
});
it('rejects original project/source accessors without reading them', () => {
  const p = fixture(),
    getter = vi.fn(() => 12);
  Object.defineProperty(p, 'duration', { enumerable: true, get: getter });
  expect(() => capture(() => ({ project: p, revision: 0, frame: 4 }))).toThrow(/data/);
  expect(getter).not.toHaveBeenCalled();
  const sourceGetter = vi.fn(() => fixture());
  expect(() =>
    capture(() => ({
      get project() {
        return sourceGetter();
      },
      revision: 0,
      frame: 4,
    })),
  ).toThrow(/data/);
  expect(sourceGetter).not.toHaveBeenCalled();
});
it('snapshots callback getters once and rejects async admission', () => {
  const p = fixture(),
    { view, requests } = operation(p),
    validate = vi.fn(),
    getter = vi.fn(() => validate);
  split(requests, {
    get validate() {
      return getter();
    },
  });
  expect(getter).toHaveBeenCalledTimes(1);
  expect(validate).toHaveBeenCalled();
  expect(() => split(requests, { validate: () => Promise.resolve() as unknown as void })).toThrow(
    /synchronous/,
  );
  view.dispose();
});
it('rejects swallowed command reentry and allows a fresh retry', () => {
  const p = fixture(),
    before = structuredClone(p),
    { view, requests } = operation(p);
  expect(() =>
    split(requests, {
      validate: () => {
        try {
          split(requests);
        } catch {
          /* swallowed */
        }
      },
    }),
  ).toThrow(/reenter/);
  expect(p).toEqual(before);
  equivalent(p, split(requests));
  view.dispose();
});
it('invalidates source-reader reentry even when its inner error is swallowed', () => {
  const p = fixture();
  let active = false;
  const view = capture(() => {
    if (active) {
      try {
        void view.scene;
      } catch {
        /* swallowed */
      }
    }
    return { project: p, revision: 0, frame: 4 };
  });
  active = true;
  expect(() => view.scene).toThrow();
  expect(() => view.choices).toThrow(/disposed/);
});
it('rejects changed request identity even when the replacement metadata is identical', () => {
  const p = fixture(),
    { view, requests } = operation(p);
  expect(() =>
    split(requests, {
      validate: () => {
        requests[0].owner = { ...requests[0].owner };
      },
    }),
  ).toThrow(/changed/);
  view.dispose();
});
it('rejects duplicate complete-track requests instead of splitting a selected subset twice', () => {
  const p = fixture((p) => {
      for (const k of p.layers[0].keys.slice(0, 2)) k.shapes.push({ ...k.shapes[0], id: 'second' });
    }),
    { view, requests } = operation(p),
    before = structuredClone(p);
  expect(() =>
    split([...requests, { owner: view.resolve('track', 'second'), rightSpanId: 'other' }]),
  ).toThrow(/once/);
  expect(p).toEqual(before);
  view.dispose();
});
function twoTracks(change?: (p: Project) => void) {
  const p = fixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  change?.(p);
  validateProject(p);
  return p;
}
function both(p: Project) {
  const view = capture(() => ({ project: p, revision: 0, frame: 4 }));
  return {
    view,
    requests: ['track', 'later'].map((layerId) => ({
      owner: view.resolve(layerId, 'art'),
      rightSpanId: 'right',
    })),
  };
}
it('prepares multiple tracks atomically with exact outside tracks and stable local IDs', () => {
  const p = twoTracks(),
    before = structuredClone(p),
    { view, requests } = both(p),
    out = split(requests);
  expect(p).toEqual(before);
  for (const l of out.layers) expect(l.keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
  equivalent(p, out);
  view.dispose();
});
it('rejects a later unrepresentable easing without publishing an earlier prepared track', () => {
  const p = twoTracks((p) => {
      p.layers[1].liveMotionSpans![0].ease = 'in-out';
      p.layers[1].liveMotionSpans![0].end = 10;
      p.layers[1].keys[1].frame = 10;
      p.layers[1].keys.pop();
    }),
    before = structuredClone(p),
    { view, requests } = both(p);
  expect(() => split(requests)).toThrow(/Preserved/);
  expect(p).toEqual(before);
  view.dispose();
});
it('rejects original incompatible endpoint topology without source writes', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].kind = 'ellipse';
  const before = structuredClone(p);
  expect(() => operation(p)).toThrow();
  expect(p).toEqual(before);
});
it('rejects derived overflow at original sampled frames without storing invalid output', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 30000000, endX: 0, endY: 30000000 };
  const before = structuredClone(p);
  expect(() => operation(p)).toThrow();
  expect(p).toEqual(before);
});
for (const late of ['source', 'target', 'output'] as const)
  it(`rejects ${late} mutation after complete edited candidate cloning`, () => {
    const p = fixture(),
      { view, requests } = operation(p),
      clone = globalThis.structuredClone;
    let hit = false;
    const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(<T>(value: T): T => {
      const result = clone(value);
      const q = value as unknown as Project;
      if (
        !hit &&
        q?.layers?.[0]?.keys?.some((k) => k.frame === 4) &&
        q.layers[0].liveMotionSpans?.length === 2
      ) {
        hit = true;
        if (late === 'source') p.layers[0].keys[1].shapes[0].x++;
        if (late === 'target') requests[0].rightSpanId = 'changed';
        if (late === 'output') (result as unknown as Project).layers[0].keys[1].shapes[0].x++;
      }
      return result;
    });
    try {
      expect(() => split(requests)).toThrow();
      expect(hit).toBe(true);
    } finally {
      spy.mockRestore();
      view.dispose();
    }
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  });

it('rejects paint rounding differences instead of silently reauthoring the old animation', () => {
  const p = fixture((p, s) => {
      s.options = { paint: true };
      p.layers[0].keys[1].shapes[0].fill = '#808080';
    }),
    before = structuredClone(p),
    { view, requests } = operation(p);
  expect(() => split(requests)).toThrow(/integer poses/);
  expect(p).toEqual(before);
  view.dispose();
});
for (const curves of [false, true])
  it(`remaps explicit ${curves ? 'curve' : 'straight'} hints through an unequal expanded shared key`, () => {
    const p = fixture((p, s) => {
        s.ease = 'in';
        s.options = { nodes: true };
        s.correspondence = { nodes: { curves, hints: [[[1, 2]]] } };
        const from = [
            { x: 0, y: 0 },
            { x: 20, y: 20 },
            { x: 40, y: 0 },
          ],
          to = [
            { x: 0, y: 0 },
            { x: 10, y: 20 },
            { x: 20, y: 30 },
            { x: 30, y: 20 },
            { x: 40, y: 0 },
          ];
        for (const k of p.layers[0].keys.slice(0, 2))
          Object.assign(k.shapes[0], {
            kind: 'bezier',
            closed: false,
            nodes: (k.frame ? to : from).map((n) => (curves ? n : { ...n, y: 0 })),
          });
      }),
      { view, requests } = operation(p),
      out = split(requests);
    equivalent(p, out);
    expect(out.layers[0].liveMotionSpans!.map((s) => s.correspondence!.nodes)).toEqual([
      { curves, hints: [[[1, 2]]] },
      { curves, hints: [[[2, 2]]] },
    ]);
    view.dispose();
  });
for (const ease of ['linear', 'in', 'out'] as const)
  it(`preserves ${ease} compound source/target ring order/reversal without changing endpoints`, () => {
    const alignment = { start: [1, 2], reverse: [true, false], order: [1, 0] };
    const p = fixture((p, s) => {
        s.ease = ease;
        s.options = { nodes: true };
        s.correspondence = { source: alignment, ...alignment };
        for (const k of p.layers[0].keys.slice(0, 2))
          Object.assign(k.shapes[0], {
            kind: 'polygon',
            fillRule: 'evenodd',
            contours: [
              [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 0, y: 20 },
              ],
              [
                { x: 3, y: 3 },
                { x: 6, y: 3 },
                { x: 6, y: 6 },
                { x: 3, y: 6 },
              ],
            ],
          });
      }),
      { view, requests } = operation(p),
      out = split(requests);
    equivalent(p, out);
    expect(out.layers[0].liveMotionSpans!.map((s) => s.correspondence)).toEqual([
      { source: alignment },
      alignment,
    ]);
    view.dispose();
  });
for (const auto of [false, true])
  it(`restricts ${auto ? 'automatic' : 'explicit'} split gradient stop groups`, () => {
    const pairs = [
      [0, 0],
      [1, 1],
      [1, 2],
      [2, 3],
    ] as const;
    const p = fixture((p, s) => {
        s.ease = 'in';
        s.options = {
          paint: true,
          gradientGeometry: true,
          gradientStops: { pairs: auto ? 'auto' : pairs },
        };
        for (const k of p.layers[0].keys.slice(0, 2))
          k.shapes[0].gradient = {
            kind: 'linear',
            from: { x: 0, y: 0 },
            to: { x: 20, y: 0 },
            stops: (k.frame ? [0, 0.2, 0.6, 1] : [0, 0.4, 0.4, 1]).map((offset) => ({
              offset,
              color: '#000000',
            })),
          };
      }),
      { view, requests } = operation(p),
      out = split(requests);
    equivalent(p, out);
    expect(
      out.layers[0].liveMotionSpans!.every((s) =>
        Array.isArray((s.options!.gradientStops as { pairs: unknown }).pairs),
      ),
    ).toBe(true);
    view.dispose();
  });
it('rejects divergent per-artwork path displacement atomically', () => {
  const p = fixture((p, s) => {
      s.path = { startX: 0, startY: 20, endX: 0, endY: 20 };
      for (const k of p.layers[0].keys.slice(0, 2))
        k.shapes.push({ ...k.shapes[0], id: 'second', x: k.frame ? 70 : 0 });
    }),
    before = structuredClone(p),
    { view, requests } = operation(p);
  expect(() => split(requests)).toThrow(/displacement/);
  expect(p).toEqual(before);
  view.dispose();
});
it('rejects mixed original source identities and frames across requests', () => {
  const p = twoTracks(),
    { view, requests } = both(p),
    other = operation(structuredClone(p)),
    different = capture(() => ({ project: p, revision: 0, frame: 2 }));
  expect(() => split([requests[1], other.requests[0]])).toThrow(/original source/);
  expect(() =>
    split([requests[1], { owner: different.resolve('track', 'art'), rightSpanId: 'right' }]),
  ).toThrow(/original source/);
  view.dispose();
  other.view.dispose();
  different.dispose();
});
it('admits independent private captures of the same original frame for different complete tracks', () => {
  const p = twoTracks(),
    a = capture(() => ({ project: p, revision: 0, frame: 4 })),
    b = capture(() => ({ project: p, revision: 0, frame: 4 }));
  equivalent(
    p,
    split([
      { owner: a.resolve('track', 'art'), rightSpanId: 'right' },
      { owner: b.resolve('later', 'art'), rightSpanId: 'right' },
    ]),
  );
  a.dispose();
  b.dispose();
});
it('fresh reopened owners support another sparse split without baselines or per-frame arrays', () => {
  const p = fixture((p, s) => {
      p.duration = 18;
      p.layers[0].keys = p.layers[0].keys.slice(0, 2);
      p.layers[0].keys[1].frame = 16;
      s.end = 16;
    }),
    a = operation(p, 8),
    out = split(a.requests),
    loaded = migrateProject(JSON.parse(JSON.stringify(out))),
    b = operation(loaded, 4);
  b.requests[0].rightSpanId = 'middle';
  const again = split(b.requests);
  equivalent(p, again);
  expect(again.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8, 16]);
  expect(again.layers[0].liveMotionSpans!.map((s) => s.id)).toEqual(['live', 'middle', 'right']);
  a.view.dispose();
  b.view.dispose();
});
it('retains the real enclosing symbol artwork budget at exact capacity', () => {
  const p = fixture();
  const art = p.layers[0].keys[0].shapes[0];
  p.symbols = [
    {
      id: 'capacity',
      name: 'Capacity',
      width: 20,
      height: 20,
      shapes: Array.from({ length: 100000 }, (_, i) => ({ ...art, id: 'capacity-' + i })),
    },
  ];
  validateProject(p);
  const { view, requests } = operation(p),
    out = split(requests);
  expect(out.symbols![0].shapes).toHaveLength(100000);
  expect(p.layers[0].keys).toHaveLength(3);
  view.dispose();
  p.symbols![0].shapes.push({ ...art, id: 'over' });
  expect(() => operation(p)).toThrow(/budget/);
}, 60000);

it('rejects an overflowing noncaptured integer pose during preservation proof atomically', () => {
  const p = fixture((_p, s) => {
      s.path = { startX: 0, startY: 50000000, endX: 0, endY: -50000000 };
    }),
    before = structuredClone(p),
    { view, requests } = operation(p);
  expect(view.scene[0].key.shapes[0].y).toBe(12);
  expect(() => split(requests)).toThrow(/shape geometry/);
  expect(p).toEqual(before);
  view.dispose();
});
it('rejects per-artwork extra-turn restrictions that cannot share one half recipe', () => {
  const p = fixture((p, s) => {
      s.rotation = { direction: 'clockwise', turns: 1 };
      for (const k of p.layers[0].keys.slice(0, 2))
        k.shapes.push({ ...k.shapes[0], id: 'second', rotation: k.frame ? 180 : 0 });
    }),
    before = structuredClone(p),
    { view, requests } = operation(p, 2);
  expect(() => split(requests)).toThrow(/shared extra-turn/);
  expect(p).toEqual(before);
  view.dispose();
});
it('rejects an altered private original clone before creating any owner', () => {
  const p = fixture(),
    clone = globalThis.structuredClone;
  let hit = false;
  const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(<T>(value: T): T => {
    const result = clone(value);
    if (value === p) {
      hit = true;
      (result as unknown as Project).layers[0].keys[0].shapes[0].x++;
    }
    return result;
  });
  try {
    expect(() => operation(p)).toThrow(/changed/);
    expect(hit).toBe(true);
  } finally {
    spy.mockRestore();
  }
  expect(p.layers[0].keys[0].shapes[0].x).toBe(8);
});
