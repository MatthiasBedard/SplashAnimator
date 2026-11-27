import { expect, it, vi } from 'vitest';
import { validateProject, type Project } from '../packages/document/src';
import { captureLiveMotionStage as capture } from '../packages/animation/src/live-motion-stage';
import { liveSplitFixture as fixture } from './live-motion-split-fixture';
import { livePresentationFixture } from './live-motion-presentation-fixture';
import { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';

it('renders exact sparse poses without altering authored endpoints/holds/outside keys or writing source', () => {
  const p = fixture(),
    before = structuredClone(p),
    view = capture(() => ({ project: p, revision: 1 }));
  for (const frame of [0, 1, 4, 7, 8, 9, 10, 11]) {
    const f = view.sample(frame);
    validateProject(f.project);
    expect(f.frame).toBe(frame);
    expect(f.project.layers[0].liveMotionSpans).toBeUndefined();
    const sampled = frame > 0 && frame < 8;
    expect(f.sampledLayerIds).toEqual(sampled ? ['track'] : []);
    expect(f.project.layers[0].keys.map((k) => k.frame)).toEqual(
      sampled ? [0, frame, 8, 10] : [0, 8, 10],
    );
    if (sampled)
      expect(f.project.layers[0].keys.find((k) => k.frame === frame)!.shapes[0].x).toBe(
        8 + frame * 10,
      );
    else expect(f.project.layers[0].keys).toEqual(p.layers[0].keys);
  }
  expect(p).toEqual(before);
  view.dispose();
});
it('allows original authored tracks but rejects sampled, forged, stale and corrupted public views', () => {
  const p = fixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'held', liveMotionSpans: undefined });
  const view = capture(() => ({ project: p, revision: 0 })),
    f = view.sample(4);
  view.assertAuthored(f, 4, ['held']);
  expect(() => view.assertAuthored(f, 4, ['track'])).toThrow(/authored live tween key/);
  expect(() => view.assertAuthored(f, 4, ['held', 'track'])).toThrow();
  expect(() => view.assertAuthored({ ...f }, 4, ['held'])).toThrow(/privately/);
  expect(() => view.assertAuthored(f, 5, ['held'])).toThrow(/current/);
  f.project.layers[1].keys[0].shapes[0].x = 900;
  expect(() => view.assertAuthored(f, 4, ['held'])).toThrow(/Public/);
  expect(p.layers[1].keys[0].shapes[0].x).toBe(8);
  const fresh = view.sample(4);
  view.assertAuthored(fresh, 4, ['held']);
  expect(() => view.assertAuthored(f, 4, ['held'])).toThrow(/current/);
  view.dispose();
});
it('invalidates old frame ownership on any subsequent sample, even when a frame is restored', () => {
  const p = fixture(),
    view = capture(() => ({ project: p, revision: 0 })),
    old = view.sample(0);
  view.assertAuthored(old, 0, ['track']);
  view.sample(4);
  view.sample(0);
  expect(() => view.assertAuthored(old, 0, ['track'])).toThrow(/current/);
  view.dispose();
});
it('returns immutable frame hints and detached cache-hit render projects', () => {
  const p = fixture(),
    view = capture(() => ({ project: p, revision: 0 })),
    a = view.sample(4),
    b = view.sample(4);
  expect(a.project).toEqual(b.project);
  expect(a.project).not.toBe(b.project);
  expect(Object.isFrozen(a)).toBe(true);
  expect(Object.isFrozen(a.sampledLayerIds)).toBe(true);
  a.project.layers[0].keys[1].shapes[0].x = 900;
  expect(view.sample(4).project.layers[0].keys[1].shapes[0].x).toBe(48);
  view.dispose();
});
for (const mode of ['graphic', 'movie', 'button'])
  it(`keeps outside ${mode} exposure origins/library/settings and stored baked child keys exact`, async () => {
    const p = livePresentationFixture(mode),
      before = structuredClone(p),
      view = capture(() => ({ project: p, revision: 0 }));
    for (const frame of [0, 1, 2, 3, 4, 7, 8]) {
      const f = view.sample(frame),
        expected = await prepareLiveMotionFrameCapture(() => ({ project: p, revision: 0 }), frame);
      expect(f.project).toEqual(expected);
      expect(f.project.layers[1]).toEqual(before.layers[1]);
      expect(f.project.symbols).toEqual(before.symbols);
    }
    expect(p).toEqual(before);
    view.dispose();
  });
for (const mode of ['hidden', 'locked'] as const)
  it(`retains ${mode} presentation while refusing authored input`, () => {
    const p = fixture();
    if (mode === 'hidden') p.layers[0].visible = false;
    else p.layers[0].locked = true;
    const view = capture(() => ({ project: p, revision: 0 })),
      f = view.sample(4);
    expect(f.sampledLayerIds).toEqual(mode === 'locked' ? ['track'] : []);
    expect(f.project.layers[0].keys).toHaveLength(mode === 'locked' ? 4 : 3);
    expect(() => view.assertAuthored(f, 4, ['track'])).toThrow(/visible unlocked/);
    view.dispose();
  });
it('applies independent root opacity channels without resetting held symbol origins or changing bindings', async () => {
  const p = livePresentationFixture();
  p.opacityBindings = [
    {
      layerId: 'graphic',
      shapeId: 'instance',
      start: 1,
      end: 4,
      keys: [
        { frame: 1, opacity: 0.2 },
        { frame: 4, opacity: 0.8 },
      ],
    },
  ];
  validateProject(p);
  const view = capture(() => ({ project: p, revision: 0 })),
    f = view.sample(2);
  expect(f.project.layers[1].keys.map((k) => k.frame)).toEqual([0, 1]);
  expect(f.project.layers[1].keys[1].shapes[0].opacity).toBeCloseTo(0.4);
  expect(f.project.opacityBindings).toEqual(p.opacityBindings);
  expect(f.project.symbols).toEqual(p.symbols);
  view.dispose();
});
for (const kind of ['ellipse', 'bezier', 'polygon'] as const)
  for (const reflected of [false, true])
    it(`keeps ${reflected ? 'reflected' : 'affine'} ${kind} pose admission exact`, async () => {
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
      });
      const view = capture(() => ({ project: p, revision: 0 }));
      expect(view.sample(4).project).toEqual(
        await prepareLiveMotionFrameCapture(() => ({ project: p, revision: 0 }), 4),
      );
      view.dispose();
    });
for (const edit of ['source', 'revision', 'identity'] as const)
  it(`retires cached output after ${edit} change and fresh capture reads current endpoints`, () => {
    let p = fixture(),
      revision = 0;
    const view = capture(() => ({ project: p, revision })),
      f = view.sample(4);
    if (edit === 'source') p.layers[0].keys[1].shapes[0].x = 128;
    if (edit === 'revision') revision++;
    if (edit === 'identity') p = structuredClone(p);
    expect(() => view.sample(4)).toThrow();
    expect(() => view.assertAuthored(f, 4, ['track'])).toThrow(/disposed/);
    const fresh = capture(() => ({ project: p, revision }));
    expect(fresh.sample(4).project.layers[0].keys[1].shapes[0].x).toBe(edit === 'source' ? 68 : 48);
    fresh.dispose();
  });
for (const frame of [-1, NaN, Infinity, 0.5, 12])
  it(`rejects exact frame ${frame} without cached fallback`, () => {
    const p = fixture(),
      view = capture(() => ({ project: p, revision: 0 }));
    view.sample(4);
    expect(() => view.sample(frame)).toThrow(/exact/);
    expect(() => view.sample(4)).toThrow(/disposed/);
  });
it('rejects a later invalid numeric sampled track instead of returning a partial or held scene', () => {
  const p = fixture();
  p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  p.layers[1].liveMotionSpans![0].path = { startX: 0, startY: 50000000, endX: 0, endY: -50000000 };
  const before = structuredClone(p),
    view = capture(() => ({ project: p, revision: 0 }));
  expect(view.sample(4).sampledLayerIds).toEqual(['track', 'later']);
  expect(() => view.sample(2)).toThrow(/shape geometry/);
  expect(() => view.sample(4)).toThrow(/disposed/);
  expect(p).toEqual(before);
});
it('does not compile or resample the same frame again on a cache hit', () => {
  const p = fixture(),
    view = capture(() => ({ project: p, revision: 0 }));
  view.sample(4);
  const clone = vi.spyOn(globalThis, 'structuredClone');
  view.sample(4);
  const hits = clone.mock.calls;
  expect(hits).toHaveLength(1);
  expect((hits[0][0] as Project).layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
  clone.mockRestore();
  view.sample(5);
  view.dispose();
});
it('snapshots validator getters once and rejects async admission', () => {
  const p = fixture(),
    validator = vi.fn(),
    getter = vi.fn(() => validator),
    view = capture(() => ({ project: p, revision: 0 }), {
      get validate() {
        return getter();
      },
    });
  view.sample(4);
  view.sample(4);
  expect(getter).toHaveBeenCalledTimes(1);
  expect(validator).toHaveBeenCalled();
  view.dispose();
  expect(() =>
    capture(() => ({ project: p, revision: 0 }), {
      validate: () => Promise.resolve() as unknown as void,
    }),
  ).toThrow(/synchronous/);
});
it('rejects source wrapper and original project getters without invoking them', () => {
  const p = fixture(),
    getter = vi.fn(() => p);
  expect(() =>
    capture(() => ({
      get project() {
        return getter();
      },
      revision: 0,
    })),
  ).toThrow(/data/);
  expect(getter).not.toHaveBeenCalled();
  const duration = vi.fn(() => 12);
  Object.defineProperty(p, 'duration', { enumerable: true, get: duration });
  expect(() => capture(() => ({ project: p, revision: 0 }))).toThrow(/data/);
  expect(duration).not.toHaveBeenCalled();
});
it('rejects invalid/unknown/duplicate/raw accessor authored track requests without consuming a valid frame', () => {
  const p = fixture(),
    view = capture(() => ({ project: p, revision: 0 })),
    f = view.sample(0),
    getter = vi.fn(() => 'track');
  for (const ids of [[], ['missing'], ['track', 'track'], [NaN]])
    expect(() => view.assertAuthored(f, 0, ids as string[])).toThrow();
  const ids: string[] = [];
  Object.defineProperty(ids, 0, { get: getter, enumerable: true });
  expect(() => view.assertAuthored(f, 0, ids)).toThrow(/data/);
  expect(getter).not.toHaveBeenCalled();
  view.assertAuthored(f, 0, ['track']);
  view.dispose();
});
it('rejects swallowed callback and source-reader reentry', () => {
  const p = fixture();
  let active = false;
  const view = capture(() => ({ project: p, revision: 0 }), {
    validate: () => {
      if (active) {
        try {
          view.sample(4);
        } catch {
          /* swallowed */
        }
      }
    },
  });
  active = true;
  expect(() => view.sample(4)).toThrow(/changed|reenter|disposed/);
  let reading = false;
  const other = capture(() => {
    if (reading) {
      try {
        other.sample(4);
      } catch {
        /* swallowed */
      }
    }
    return { project: p, revision: 0 };
  });
  reading = true;
  expect(() => other.sample(4)).toThrow();
});
for (const when of ['before', 'after', 'cached'] as const)
  it(`rejects ${when} abort and retires resources/ownership`, () => {
    const p = fixture(),
      controller = new AbortController();
    if (when === 'before') controller.abort();
    if (when === 'before') {
      expect(() =>
        capture(() => ({ project: p, revision: 0 }), { signal: controller.signal }),
      ).toThrow();
      return;
    }
    const view = capture(() => ({ project: p, revision: 0 }), { signal: controller.signal });
    if (when === 'cached') view.sample(4);
    controller.abort();
    expect(() => view.sample(4)).toThrow();
    expect(() => view.sample(0)).toThrow(/disposed/);
  });
for (const late of ['source', 'output', 'dispose'] as const)
  it(`rejects late complete render-frame ${late} changes with no source write`, () => {
    const p = fixture(),
      view = capture(() => ({ project: p, revision: 0 })),
      clone = globalThis.structuredClone;
    let hit = false;
    const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(<T>(value: T): T => {
      const out = clone(value),
        v = value as unknown as Project;
      if (
        !hit &&
        v?.layers?.[0]?.keys?.some((k) => k.frame === 4) &&
        !v.layers[0].liveMotionSpans
      ) {
        hit = true;
        if (late === 'source') p.layers[0].keys[1].shapes[0].x++;
        if (late === 'output') (out as unknown as Project).layers[0].keys[1].shapes[0].x++;
        if (late === 'dispose') view.dispose();
      }
      return out;
    });
    try {
      expect(() => view.sample(4)).toThrow();
      expect(hit).toBe(true);
    } finally {
      spy.mockRestore();
      view.dispose();
    }
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  });
it('disposes immediately and never returns cached views afterward', () => {
  const p = fixture(),
    view = capture(() => ({ project: p, revision: 0 })),
    f = view.sample(0);
  view.dispose();
  view.dispose();
  expect(() => view.sample(0)).toThrow(/disposed/);
  expect(() => view.assertAuthored(f, 0, ['track'])).toThrow(/disposed/);
});

it('admits render publication independently of authored input when every root is sampled', () => {
  const p = fixture(),
    view = capture(() => ({ project: p, revision: 0 })),
    f = view.sample(4);
  view.assertFrame(f, 4);
  expect(() => view.assertAuthored(f, 4, ['track'])).toThrow();
  expect(() => view.assertFrame(f, 5)).toThrow();
  view.dispose();
});
it('rejects late source edits at render publication and never revives old frame ownership', () => {
  const p = fixture(),
    view = capture(() => ({ project: p, revision: 0 })),
    f = view.sample(4);
  p.layers[0].keys[1].shapes[0].x++;
  expect(() => view.assertFrame(f, 4)).toThrow(/changed/);
  p.layers[0].keys[1].shapes[0].x--;
  expect(() => view.assertFrame(f, 4)).toThrow(/disposed/);
});

it('keeps long-duration storage sparse while replacing only the current private frame cache', () => {
  const p = fixture((p, s) => {
      p.duration = 100000;
      p.layers[0].keys = p.layers[0].keys.slice(0, 2);
      p.layers[0].keys[1].frame = 99999;
      s.end = 99999;
    }),
    view = capture(() => ({ project: p, revision: 0 }));
  for (const frame of [1, 50000, 99998]) {
    const f = view.sample(frame);
    expect(f.project.layers[0].keys.map((k) => k.frame)).toEqual([0, frame, 99999]);
    view.assertFrame(f, frame);
  }
  expect(p.layers[0].keys).toHaveLength(2);
  view.dispose();
});
it('admits the actual original symbol artwork budget and rejects an over-budget fresh source', () => {
  const p = fixture(),
    art = p.layers[0].keys[0].shapes[0];
  p.symbols = [
    {
      id: 'library',
      name: 'Library',
      width: 20,
      height: 20,
      shapes: Array.from({ length: 100000 }, (_, i) => ({ ...art, id: 's' + i })),
    },
  ];
  const view = capture(() => ({ project: p, revision: 0 })),
    f = view.sample(4);
  expect(f.project.symbols![0].shapes).toHaveLength(100000);
  expect(p.layers[0].keys).toHaveLength(3);
  view.dispose();
  p.symbols[0].shapes.push({ ...art, id: 'over' });
  expect(() => capture(() => ({ project: p, revision: 0 }))).toThrow(/budget/);
}, 120000);

it('rechecks public frame integrity after the final authored-operation callback', () => {
  const p = fixture();
  let armed = false,
    calls = 0;
  const view = capture(() => ({ project: p, revision: 0 }), {
    validate: () => {
      if (armed && ++calls === 2) f.project.layers[0].keys[0].shapes[0].x++;
    },
  });
  const f = view.sample(0);
  armed = true;
  expect(() => view.assertAuthored(f, 0, ['track'])).toThrow(/Public/);
  expect(calls).toBe(2);
  expect(p.layers[0].keys[0].shapes[0].x).toBe(8);
  view.dispose();
});
