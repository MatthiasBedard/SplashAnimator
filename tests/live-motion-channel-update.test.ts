import { expect, it, vi } from 'vitest';
import { newProject, validateProject, type Project, type Vector } from '../packages/document/src';
import {
  prepareUpdateLiveMotionSpans as update,
  prepareRemoveLiveMotionSpans as remove,
  captureLiveMotionTimeline as capture,
  type UpdateLiveMotionRequest,
} from '../packages/animation/src/live-motion';
import type { MotionEase } from '../packages/document/src/motion-ease';

function fixture(two = false): Project {
  const p = newProject();
  p.duration = 10;
  p.layers[0].id = 'track';
  const art: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 0,
    y: 20,
    width: 40,
    height: 30,
    rotation: 0,
    opacity: 0.2,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [art] },
    { frame: 4, shapes: [{ ...structuredClone(art), x: 80, opacity: 1, fill: '#808080' }] },
    { frame: 8, shapes: [] },
  ];
  p.layers[0].liveMotionSpans = [
    {
      id: 'live',
      start: 0,
      end: 4,
      ease: 'in',
      opacityEase: 'linear',
      paintEase: 'linear',
      options: { paint: true },
      rotation: { direction: 'clockwise', turns: 0 },
    },
  ];
  if (two) p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  return p;
}
const req = (
  changes: UpdateLiveMotionRequest['changes'],
  layerId = 'track',
): UpdateLiveMotionRequest => ({ layerId, spanId: 'live', changes });
function sample(p: Project, f = 2) {
  const c = capture(() => ({ project: p, revision: 0 }));
  try {
    return c.sample(f)[0].key.shapes[0];
  } finally {
    c.dispose();
  }
}
const cubic = { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 0 } as const;
const choices: readonly (MotionEase | undefined)[] = ['in', 'out', cubic, undefined];
const half = (e: MotionEase | undefined) =>
  e === 'out' ? 0.75 : typeof e === 'object' ? 0.125 : 0.25;

for (const opacityEase of choices)
  for (const paintEase of choices)
    it(`independent opacity ${JSON.stringify(opacityEase)} and paint ${JSON.stringify(paintEase)} preserve geometry`, () => {
      const p = fixture(),
        before = structuredClone(p),
        requests = [req({ opacityEase, paintEase })],
        out = update(p, requests),
        expected = structuredClone(p),
        span = expected.layers[0].liveMotionSpans![0];
      if (opacityEase === undefined) delete span.opacityEase;
      else span.opacityEase = opacityEase;
      if (paintEase === undefined) delete span.paintEase;
      else span.paintEase = paintEase;
      expect(out).toEqual(expected);
      expect(p).toEqual(before);
      expect(out.layers[0].keys).toEqual(before.layers[0].keys);
      const mid = sample(out),
        v = Math.round(128 * half(paintEase))
          .toString(16)
          .padStart(2, '0');
      expect(mid.x).toBe(20);
      expect(mid.opacity).toBeCloseTo(0.2 + 0.8 * half(opacityEase), 12);
      expect(mid.fill).toBe('#' + v.repeat(3));
      expect(sample(out, 0)).toEqual(before.layers[0].keys[0].shapes[0]);
      expect(sample(out, 4)).toEqual(before.layers[0].keys[1].shapes[0]);
      expect(sample(out, 6)).toEqual(before.layers[0].keys[1].shapes[0]);
      expect(validateProject(JSON.parse(JSON.stringify(out)))).toEqual(out);
    });

for (const channel of ['opacityEase', 'paintEase'] as const)
  it(`omission preserves ${channel} while changing the other channel`, () => {
    const p = fixture(),
      other = channel === 'opacityEase' ? 'paintEase' : 'opacityEase',
      out = update(p, [req({ [other]: 'out' })]);
    expect(out.layers[0].liveMotionSpans![0][channel]).toBe('linear');
    expect(out.layers[0].liveMotionSpans![0].ease).toBe('in');
    expect(out.layers[0].keys).toEqual(p.layers[0].keys);
  });

it('cleared channels inherit later geometry timing changes without materializing metadata', () => {
  let p = update(fixture(), [req({ opacityEase: undefined, paintEase: undefined })]);
  p = update(p, [req({ ease: 'out' })]);
  const span = p.layers[0].liveMotionSpans![0];
  expect(Object.hasOwn(span, 'opacityEase')).toBe(false);
  expect(Object.hasOwn(span, 'paintEase')).toBe(false);
  expect(sample(p).x).toBe(60);
  expect(sample(p).opacity).toBeCloseTo(0.8);
  expect(sample(p).fill).toBe('#606060');
});

it('explicit channel removal can be paired with disabling paint, but does not enable paint itself', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].fill = '#000000';
  const before = structuredClone(p);
  expect(() => update(p, [req({ options: { paint: false } })])).toThrow();
  expect(p).toEqual(before);
  const out = update(p, [req({ options: { paint: false }, paintEase: undefined })]);
  expect(out.layers[0].liveMotionSpans![0].options).toEqual({ paint: false });
  expect(Object.hasOwn(out.layers[0].liveMotionSpans![0], 'paintEase')).toBe(false);
  expect(out.layers[0].liveMotionSpans![0].opacityEase).toBe('linear');
  expect(() => update(out, [req({ paintEase: 'out' })])).toThrow();
  expect(out.layers[0].liveMotionSpans![0].options).toEqual({ paint: false });
});

it('later authored endpoint changes use independent channel progress without Refresh', () => {
  const out = update(fixture(), [req({ opacityEase: 'out', paintEase: cubic })]),
    c = capture(() => ({ project: out, revision: 0 }));
  out.layers[0].keys[1].shapes[0].opacity = 0.6;
  out.layers[0].keys[1].shapes[0].fill = '#404040';
  out.layers[0].keys[1].shapes[0].x = 120;
  expect(() => c.sample(2)).toThrow();
  c.dispose();
  const mid = sample(out);
  expect(mid.x).toBe(30);
  expect(mid.opacity).toBeCloseTo(0.5);
  expect(mid.fill).toBe('#080808');
  expect(sample(validateProject(JSON.parse(JSON.stringify(out))))).toEqual(mid);
  expect(out.layers[0].keys).toHaveLength(3);
});

it('mixed multiple requests retain untouched geometry/option/channel data and detach outputs', () => {
  const p = fixture(true);
  p.layers[1].liveMotionSpans![0].opacityEase = 'out';
  const before = structuredClone(p),
    requests = [req({ paintEase: cubic }), req({ opacityEase: undefined }, 'later')],
    out = update(p, requests);
  expect(out.layers[0].liveMotionSpans![0].opacityEase).toBe('linear');
  expect(out.layers[1].liveMotionSpans![0].paintEase).toBe('linear');
  expect(p).toEqual(before);
  out.layers[0].liveMotionSpans![0].paintEase = 'in';
  out.layers[0].keys[0].shapes[0].fill = '#ffffff';
  expect(p).toEqual(before);
  expect(requests[0].changes.paintEase).toEqual(cubic);
});

it('channel edits retain an authored cubic trajectory and its independent geometry parameterization', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 0, endX: 0, endY: 0 };
  const out = update(p, [req({ opacityEase: 'out', paintEase: cubic })]);
  // Geometry ease-in gives t=1/4; endpoint-anchored cubic controls yield 3t²-2t³=5/32.
  expect(sample(out).x).toBe((80 * 5) / 32);
  expect(sample(out).opacity).toBeCloseTo(0.8);
  expect(sample(out).fill).toBe('#101010');
  expect(out.layers[0].liveMotionSpans![0].path).toEqual(p.layers[0].liveMotionSpans![0].path);
});

for (const channel of ['opacityEase', 'paintEase'] as const)
  it(`rejects unknown custom ${channel} control fields without normalizing the request`, () => {
    const p = fixture(),
      before = structuredClone(p),
      requests = [
        req({ [channel]: { ...cubic, extra: true } } as UpdateLiveMotionRequest['changes']),
      ];
    const clone = structuredClone;
    let cloneCalls = 0;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      cloneCalls++;
      return clone(value);
    });
    try {
      expect(() => update(p, requests)).toThrow(/Unknown/);
      expect(cloneCalls).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(p).toEqual(before);
    expect(requests[0].changes[channel]).toEqual({ ...cubic, extra: true });
  });

for (const channel of ['opacityEase', 'paintEase'] as const)
  for (const value of [
    'unknown',
    null,
    NaN,
    Infinity,
    { kind: 'cubic', x1: NaN, y1: 0, x2: 1, y2: 1 },
    { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: Infinity },
    { kind: 'cubic', x1: -1, y1: 0, x2: 1, y2: 1 },
  ])
    it(`rejects raw ${channel} ${JSON.stringify(value)} before transport normalization`, () => {
      const p = fixture(),
        before = structuredClone(p);
      expect(() =>
        update(p, [req({ [channel]: value } as UpdateLiveMotionRequest['changes'])]),
      ).toThrow();
      expect(p).toEqual(before);
    });

for (const place of ['request', 'control', 'nonenumerable'])
  it(`original channel ${place} cannot execute getters or disappear in transport`, () => {
    const p = fixture(),
      requests = [req({ opacityEase: { ...cubic } })];
    let reads = 0;
    if (place === 'request')
      Object.defineProperty(requests[0].changes, 'opacityEase', {
        enumerable: true,
        get() {
          reads++;
          return 'out';
        },
      });
    if (place === 'control')
      Object.defineProperty(requests[0].changes.opacityEase!, 'y1', {
        enumerable: true,
        get() {
          reads++;
          return 0;
        },
      });
    if (place === 'nonenumerable')
      Object.defineProperty(requests[0].changes, 'paintEase', { enumerable: false, value: 'out' });
    expect(() => update(p, requests)).toThrow();
    expect(reads).toBe(0);
  });

for (const mode of ['missing', 'duplicate', 'locked', 'hidden', 'dependency', 'geometry'])
  it(`later ${mode} rejection leaves every selected channel exact`, () => {
    const p = fixture(true),
      requests = [req({ opacityEase: 'out' }), req({ paintEase: cubic }, 'later')];
    if (mode === 'missing') requests[1].spanId = 'missing';
    if (mode === 'duplicate') requests[1] = structuredClone(requests[0]);
    if (mode === 'locked') p.layers[1].locked = true;
    if (mode === 'hidden') p.layers[1].visible = false;
    if (mode === 'dependency') {
      delete p.layers[1].liveMotionSpans![0].paintEase;
      delete p.layers[1].liveMotionSpans![0].options;
      p.layers[1].keys[1].shapes[0].fill = '#000000';
    }
    if (mode === 'geometry') p.layers[1].keys[1].shapes[0].width = 80;
    const before = structuredClone(p);
    expect(() => update(p, requests)).toThrow();
    expect(p).toEqual(before);
    expect(update(p, [requests[0]]).layers[1]).toEqual(before.layers[1]);
  });

for (const mode of ['input', 'source', 'revision', 'reentry', 'async'])
  it(`channel ${mode} admission rejects stale work and permits fresh retries`, () => {
    const p = fixture(),
      requests = [req({ opacityEase: 'out' })],
      before = structuredClone(p);
    let fired = false;
    expect(() =>
      update(p, requests, {
        validate: () => {
          if (fired) return;
          fired = true;
          if (mode === 'input') requests[0].changes.opacityEase = 'in';
          if (mode === 'source') p.name = 'Independent edit';
          if (mode === 'revision') {
            p.name = 'temporary';
            p.name = before.name;
            throw Error('Enclosing revision changed.');
          }
          if (mode === 'reentry') {
            try {
              update(p, requests);
            } catch {
              /* swallowed reentry still invalidates */
            }
          }
          if (mode === 'async') return Promise.resolve() as unknown as void;
        },
      }),
    ).toThrow();
    expect(p.layers).toEqual(before.layers);
    expect(update(p, [req({ opacityEase: 'out' })]).layers[0].liveMotionSpans![0].opacityEase).toBe(
      'out',
    );
  });

for (const mode of ['requestClone', 'outputClone', 'lateSource', 'lateCandidate'])
  it(`asserted channel ${mode} corruption rejects without output publication`, () => {
    const p = fixture(),
      before = structuredClone(p),
      clone = structuredClone;
    let hit = false,
      candidate: Project | undefined;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        q = out as Project;
      if (value === p) candidate = q;
      if (!hit && mode === 'requestClone' && Array.isArray(out) && out[0]?.changes) {
        hit = true;
        out[0].changes.opacityEase = 'in';
      }
      if (!hit && q?.layers?.[0]?.liveMotionSpans?.[0]?.opacityEase === 'out') {
        hit = true;
        if (mode === 'outputClone') q.layers[0].liveMotionSpans![0].opacityEase = 'in';
        if (mode === 'lateSource') p.name = 'Independent edit';
        if (mode === 'lateCandidate') candidate!.layers[0].liveMotionSpans![0].opacityEase = 'in';
      }
      return out;
    });
    try {
      expect(() => update(p, [req({ opacityEase: 'out' })])).toThrow();
      expect(hit).toBe(true);
      expect(p.layers).toEqual(before.layers);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(update(p, [req({ opacityEase: 'out' })]).layers[0].liveMotionSpans![0].opacityEase).toBe(
      'out',
    );
  });

it('overflowing endpoint data and unsupported fields reject without changing recovery', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].x = 1e308;
  const before = structuredClone(p);
  expect(() => update(p, [req({ opacityEase: 'out' })])).toThrow();
  expect(p).toEqual(before);
  const valid = fixture();
  expect(() =>
    update(valid, [
      req({
        opacityEase: 'out',
        paintEase: cubic,
        unknown: true,
      } as UpdateLiveMotionRequest['changes']),
    ]),
  ).toThrow();
  valid.layers[0].keys[1].shapes[0].kind = 'ellipse';
  expect(() => update(valid, [req({ opacityEase: 'out' })])).toThrow();
  expect(remove(valid, [{ layerId: 'track', spanId: 'live' }]).layers[0].keys).toEqual(
    valid.layers[0].keys,
  );
});
