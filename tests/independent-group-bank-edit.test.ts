import { afterEach, expect, it, vi } from 'vitest';
import { independentGroupBankChange as patch } from '../packages/animation/src/independent-group-bank-edit';
import { prepareUpdateLiveMotionSpans } from '../packages/animation/src/live-motion';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { liveRotationFixture } from './live-motion-rotation-fixture';
const points = { startX: 10, startY: -20, endX: 70, endY: 6 };
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const { p } = liveRotationFixture('rigid', 'reflected', true),
    l = p.layers[0];
  l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 80,
    y: s.y + 16,
  }));
  l.liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  return p;
}
it('adds an explicit group-only cubic without changing source/options/keys', () => {
  const p = fixture(),
    before = structuredClone(p),
    groupPaths = patch(p, 'track', 'live', 'outer', 'set', points),
    q = prepareUpdateLiveMotionSpans(p, [
      { layerId: 'track', spanId: 'live', changes: { groupPaths } },
    ]);
  expect(groupPaths).toEqual([
    {
      groupId: 'outer',
      composition: 'additive',
      path: { startX: 10, startY: -40, endX: -10, endY: -30 },
    },
  ]);
  expect(p).toEqual(before);
  expect(q.layers[0].keys).toEqual(p.layers[0].keys);
  expect(q.layers[0].liveMotionSpans![0].path).toEqual(p.layers[0].liveMotionSpans![0].path);
});
it('straight activation preserves integer poses through existing numerical admission', () => {
  const p = fixture(),
    groupPaths = patch(p, 'track', 'live', 'outer', 'set', {
      startX: 80 / 3,
      startY: 20 + 16 / 3,
      endX: 80 - 80 / 3,
      endY: 36 - 16 / 3,
    }),
    q = prepareUpdateLiveMotionSpans(p, [
      { layerId: 'track', spanId: 'live', changes: { groupPaths } },
    ]),
    a = createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]),
    b = createMotionFrameSampler(q, 'track', q.layers[0].liveMotionSpans![0]);
  for (let f = 0; f <= 8; f++) expect(sameMotionArtwork(a.sample(f), b.sample(f))).toBe(true);
  a.dispose();
  b.dispose();
});
it('removes the last route without retaining a default field', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].groupPaths = patch(p, 'track', 'live', 'outer', 'set', points);
  expect(patch(p, 'track', 'live', 'outer', 'remove')).toBeUndefined();
});
it('retains other bank rows/order/distance and untouched original control values', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].groupPaths = [
    {
      groupId: 'second',
      composition: 'additive',
      path: { startX: 1, startY: 2, endX: 3, endY: 4 },
    },
    {
      groupId: 'outer',
      composition: 'additive',
      path: { startX: 10, startY: -40, endX: -10, endY: -30, distance: false },
    },
  ];
  const before = structuredClone(p),
    bank = patch(p, 'track', 'live', 'outer', 'set', { ...points, startX: 11 })!;
  expect(bank[0]).toEqual(p.layers[0].liveMotionSpans![0].groupPaths![0]);
  expect(bank[1].path).toEqual({ startX: 11, startY: -40, endX: -10, endY: -30, distance: false });
  expect(p).toEqual(before);
});
it('rejects no-op set and missing removal', () => {
  const p = fixture();
  expect(() => patch(p, 'track', 'live', 'outer', 'remove')).toThrow();
  p.layers[0].liveMotionSpans![0].groupPaths = patch(p, 'track', 'live', 'outer', 'set', points);
  expect(() => patch(p, 'track', 'live', 'outer', 'set', points)).toThrow(/unchanged/);
});
for (const mode of ['NaN', 'getter', 'hidden', 'prototype', 'missing', 'extra'])
  it(`rejects raw ${mode} coordinates`, () => {
    const p = fixture(),
      v = { ...points },
      before = structuredClone(p);
    let reads = 0;
    if (mode === 'NaN') v.startX = NaN;
    if (mode === 'getter')
      Object.defineProperty(v, 'startX', {
        enumerable: true,
        get() {
          reads++;
          return 10;
        },
      });
    if (mode === 'hidden') Object.defineProperty(v, 'startX', { enumerable: false, value: 10 });
    if (mode === 'prototype') Object.setPrototypeOf(v, { x: 2 });
    if (mode === 'missing') delete (v as Partial<typeof v>).endY;
    if (mode === 'extra') Object.assign(v, { x: 1 });
    expect(() => patch(p, 'track', 'live', 'outer', 'set', v)).toThrow();
    expect(reads).toBe(0);
    expect(p).toEqual(before);
  });
for (const mode of ['locked', 'hidden', 'group', 'basis', 'displacement'])
  it(`rejects unsupported ${mode} activation`, () => {
    const p = fixture();
    if (mode === 'locked') p.layers[0].locked = true;
    if (mode === 'hidden') p.layers[0].visible = false;
    if (mode === 'basis') p.layers[0].keys[1].shapes[0].transform = [2, 0, 0, 2];
    if (mode === 'displacement') p.layers[0].keys[1].shapes[1].x++;
    expect(() =>
      patch(p, 'track', 'live', mode === 'group' ? 'missing' : 'outer', 'set', points),
    ).toThrow();
  });
it('rejects forged bank clones before returning another group edit', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].groupPaths = patch(p, 'track', 'live', 'second', 'set', points);
  const clone = structuredClone;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v);
    if (Array.isArray(out) && out[0]?.groupId) out[0].path.startX++;
    return out;
  });
  expect(() => patch(p, 'track', 'live', 'outer', 'set', points)).toThrow(/clone changed/);
});

it('explicitly replaces a waypoint bank with a cubic while retaining its distance mode', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].groupPaths = [
    {
      groupId: 'outer',
      composition: 'additive',
      path: {
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        waypoints: [{ x: 40, y: 30 }],
        curvedWaypoints: true,
        distance: true,
      },
    },
  ];
  const bank = patch(p, 'track', 'live', 'outer', 'set', points)!;
  expect(bank[0].path).toEqual({ startX: 10, startY: -40, endX: -10, endY: -30, distance: true });
  expect(p.layers[0].liveMotionSpans![0].groupPaths![0].path.waypoints).toHaveLength(1);
});
it('removes an orphaned saved bank without discarding artwork', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].groupPaths = [
    {
      groupId: 'orphan',
      composition: 'additive',
      path: { startX: 1, startY: 2, endX: 3, endY: 4 },
    },
  ];
  const keys = structuredClone(p.layers[0].keys);
  expect(patch(p, 'track', 'live', 'orphan', 'remove')).toBeUndefined();
  expect(p.layers[0].keys).toEqual(keys);
});

it('captures authoritative coordinates before clone callbacks and rejects late changes', () => {
  const p = fixture(),
    v = { ...points },
    clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value);
    if (Array.isArray(out) && !fired) {
      fired = true;
      v.startX = 900;
    }
    return out;
  });
  expect(() => patch(p, 'track', 'live', 'outer', 'set', v)).toThrow(/coordinates changed/);
  expect(fired).toBe(true);
  expect(p.layers[0].liveMotionSpans![0].groupPaths).toBeUndefined();
});
it('rejects invalid numeric input before any bank clone executes', () => {
  const p = fixture(),
    clone = structuredClone;
  let clones = 0;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    clones++;
    return clone(v);
  });
  expect(() => patch(p, 'track', 'live', 'outer', 'set', { ...points, startX: NaN })).toThrow();
  expect(clones).toBe(0);
});

it('edits only custom waypoint timing and restores linear timing on the same route', () => {
  const p=fixture(), layer=p.layers[0], span=layer.liveMotionSpans![0];
  delete span.path;
  span.groupPaths=[{groupId:'outer',composition:'additive',path:{
    startX:0,startY:0,endX:0,endY:0,waypoints:[{x:32,y:32}],
    curvedWaypoints:true,waypointTangents:[{x:8,y:12},{x:12,y:0},{x:8,y:4}],
    waypointIncoming:[{x:-8,y:0}],
  }}];
  const source=structuredClone(p), timing={kind:'cubic' as const,x1:0.2,y1:0,x2:0.8,y2:0.6};
  const changed=patch(p,layer.id,span.id,'outer','timing',undefined,timing)!;
  expect(changed).toEqual([{...span.groupPaths[0],ease:timing}]);
  expect(p).toEqual(source);
  const q=prepareUpdateLiveMotionSpans(p,[{layerId:layer.id,spanId:span.id,changes:{groupPaths:changed}}]);
  expect(()=>patch(q,layer.id,span.id,'outer','timing',undefined,timing)).toThrow(/unchanged/);
  expect(patch(q,layer.id,span.id,'outer','timing',undefined,'linear')).toEqual(span.groupPaths);
  expect(()=>patch(p,layer.id,span.id,'outer','timing',points,timing)).toThrow();
});
