import { afterEach, expect, it, vi } from 'vitest';
import {
  validateProject,
  migrateProject,
  type Project,
  type Layer,
} from '../packages/document/src';
import type { MotionEase } from '../packages/document/src/motion-ease';
import { splitLiveGroupMotionLayer as split } from '../packages/animation/src/live-group-motion-split';
import { createMotionPathSampler } from '../packages/animation/src/motion-path';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import {
  captureLiveGroupMotionAuthoringFrame as capture,
  prepareSplitLiveGroupMotionSpans as prepare,
} from '../packages/animation/src/live-group-motion-owner';
afterEach(() => vi.unstubAllGlobals());
function fixture(basis = 'plain', shared = false, group = 'outer', ease: MotionEase = 'linear') {
  const { p } = liveRotationFixture('rigid', basis, true),
    l = p.layers[0];
  l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 80,
    y: s.y + 16,
  }));
  const span = l.liveMotionSpans![0];
  span.ease = ease;
  if (shared) span.path = { startX: 4, startY: 40, endX: -7, endY: 24 };
  span.groupPaths = [
    {
      groupId: group,
      composition: 'additive',
      path: { startX: 13, startY: -40, endX: -9, endY: -12, distance: false, tangent: false },
    },
  ];
  return p;
}
function operation(p: Project, at = 4) {
  return split(p, p.layers[0], p.layers[0].liveMotionSpans![0], at, 'right');
}
function equivalent(p: Project, l: Layer) {
  const original = createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0]),
    q = { ...p, layers: [l] };
  const plans = l.liveMotionSpans!.map((s) => createMotionFrameSampler(q, l.id, s));
  for (let f = 0; f <= 8; f++) {
    const index = l.liveMotionSpans!.findIndex((s) => s.start <= f && f <= s.end),
      a = original.sample(f),
      b = plans[index].sample(f);
    expect(sameMotionArtwork(a, b), `frame ${f}`).toBe(true);
    for (let i = 0; i < a.length; i++) {
      const x = mapPoint(matrix(a[i]), { x: 3, y: 4 }),
        y = mapPoint(matrix(b[i]), { x: 3, y: 4 });
      expect(x.x).toBeCloseTo(y.x, 9);
      expect(x.y).toBeCloseTo(y.y, 9);
    }
  }
  original.dispose();
  plans.forEach((s) => s.dispose());
}
for (const basis of ['plain', 'affine', 'reflected'])
  for (const shared of [false, true])
    for (const group of ['outer', 'second'])
      for (const ease of ['linear', 'in', 'out'] as const)
        it(`restricts ${group}/${basis}/shared${shared}/${ease} without changing original artwork`, () => {
          const p = fixture(basis, shared, group, ease),
            before = structuredClone(p),
            l = operation(p);
          equivalent(p, l);
          expect(p).toEqual(before);
          expect(l.keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
          expect(l.keys[0]).toEqual(p.layers[0].keys[0]);
          expect(l.keys[2]).toEqual(p.layers[0].keys[1]);
          expect(l.keys[3]).toEqual(p.layers[0].keys[2]);
          for (const s of l.liveMotionSpans!) {
            expect(s.options).toEqual(p.layers[0].liveMotionSpans![0].options);
            expect(s.groupPaths![0].groupId).toBe(group);
            expect(s.groupPaths![0].path.distance).toBe(false);
            expect(s.groupPaths![0].path.tangent).toBe(false);
          }
          const q = { ...p, layers: [l] };
          expect(migrateProject(JSON.parse(JSON.stringify(q)))).toEqual(q);
        });
for (const shared of [false, true])
  for (const at of [2, 3, 5, 6])
    it(`restricts an asymmetric cut ${at}/shared${shared}`, () => {
      const p = fixture('reflected', shared),
        l = operation(p, at);
      equivalent(p, l);
    });
it('restricts two independent groups with different endpoint travel and retained shared loose roots', () => {
  const p = fixture('affine', true),
    l = p.layers[0],
    s = l.liveMotionSpans![0];
  for (const shape of l.keys[1].shapes.filter((v) => v.groups?.[0] === 'outer')) {
    shape.x += 20;
    shape.y += 8;
  }
  s.groupPaths = [
    ...s.groupPaths!,
    {
      groupId: 'second',
      composition: 'additive',
      path: { startX: -12, startY: 10, endX: 20, endY: 25 },
    },
  ];
  equivalent(p, operation(p));
});
for (const shared of [false, true])
  it(`recursively subdivides both halves without new keys outside the span, shared${shared}`, () => {
    const p = fixture('plain', shared),
      first = operation(p),
      q = { ...p, layers: [first] },
      left = split(q, first, first.liveMotionSpans![0], 2, 'left-mid'),
      r = { ...p, layers: [left] },
      right = split(r, left, left.liveMotionSpans![2], 6, 'right-mid');
    equivalent(p, right);
    expect(right.keys.map((k) => k.frame)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  });
for (const kind of ['bank distance', 'bank waypoint', 'shared distance', 'shared implicit curve'])
  it(`rejects unqualified ${kind} restriction while leaving valid playback available`, () => {
    const p = fixture('plain', true),
      s = p.layers[0].liveMotionSpans![0];
    if (kind === 'bank distance') s.groupPaths![0].path.distance = true;
    if (kind === 'bank waypoint') s.groupPaths![0].path.waypoints = [{ x: 40, y: -20 }];
    if (kind === 'shared distance') s.path!.distance = true;
    if (kind === 'shared implicit curve') {
      s.path!.curvedWaypoints = true;
      s.path!.waypoints = [
        { x: 25, y: 30 },
        { x: 60, y: -10 },
      ];
    }
    const before = structuredClone(p);
    expect(() => operation(p)).toThrow(/parametric cubic/);
    expect(p).toEqual(before);
    const sampler = createMotionFrameSampler(p, 'track', s);
    expect(sampler.sample(4)).toHaveLength(5);
    sampler.dispose();
  });
it('rejects conflicting unbanked shared leaders rather than adding implicit routes', () => {
  const p = fixture('plain', true);
  p.layers[0].keys[1].shapes.find((s) => s.id === 'loose')!.x++;
  expect(() => operation(p)).toThrow(/matching endpoint displacement/);
});
it('preserves explicit empty banks with the existing shared waypoint split', () => {
  const p = fixture('plain', true),
    s = p.layers[0].liveMotionSpans![0];
  s.groupPaths = [];
  s.path = { startX: 0, startY: 0, endX: 0, endY: 0, waypoints: [{ x: 40, y: 20 }] };
  const l = operation(p);
  equivalent(p, l);
  expect(l.liveMotionSpans!.map((s) => s.groupPaths)).toEqual([[], []]);
});
it('rejects raw bank accessors before evaluating them', () => {
  const p = fixture();
  let reads = 0;
  Object.defineProperty(p.layers[0].liveMotionSpans![0], 'groupPaths', {
    enumerable: true,
    get() {
      reads++;
      return [];
    },
  });
  expect(() => operation(p)).toThrow();
  expect(reads).toBe(0);
});

for (const shared of [false, true])
  it(`privately prepares both banked tracks at once, shared${shared}`, () => {
    const p = fixture('reflected', shared);
    secondRotationTrack(p);
    const before = structuredClone(p),
      scope = capture(() => ({ project: p, revision: 3, frame: 4 })),
      requests = ['track', 'later'].map((layer) => ({
        owner: scope.resolve(layer, 'outer'),
        rightSpanId: 'right',
      }));
    const q = prepare(requests);
    validateProject(q);
    expect(q.layers.map((l) => l.keys.map((k) => k.frame))).toEqual([
      [0, 4, 8, 10],
      [0, 4, 8, 10],
    ]);
    expect(q.symbols).toEqual(p.symbols);
    expect(p).toEqual(before);
    equivalent(p, q.layers[0]);
    q.layers[0].liveMotionSpans![0].groupPaths![0].path.startX = 900;
    expect(p).toEqual(before);
    scope.dispose();
  });
it('rejects a later unqualified bank without returning or writing an earlier split', () => {
  const p = fixture('plain', true);
  const l = secondRotationTrack(p);
  l.liveMotionSpans![0].groupPaths![0].path.distance = true;
  const before = structuredClone(p),
    scope = capture(() => ({ project: p, revision: 0, frame: 4 })),
    requests = ['track', 'later'].map((id) => ({
      owner: scope.resolve(id, 'outer'),
      rightSpanId: 'right',
    }));
  expect(() => prepare(requests)).toThrow(/parametric cubic/);
  expect(p).toEqual(before);
  scope.dispose();
});
it('retains compound rings, paint and absent/saved pivots without option enabling', () => {
  const p = fixture('reflected', true);
  for (const k of p.layers[0].keys.slice(0, 2)) {
    Object.assign(k.shapes[0], {
      kind: 'polygon',
      fillRule: 'evenodd',
      points: [],
      contours: [
        [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 10, y: 20 },
        ],
        [
          { x: 4, y: 4 },
          { x: 6, y: 4 },
          { x: 6, y: 6 },
          { x: 4, y: 6 },
        ],
      ],
    });
    delete k.shapes[0].pivot;
  }
  const l = operation(p);
  equivalent(p, l);
  expect(l.keys[1].shapes[0].pivot).toBeUndefined();
  expect(l.keys[1].shapes[0].contours).toEqual(p.layers[0].keys[0].shapes[0].contours);
});
for (const origin of [-99000, 99000])
  it(`retains relative document numerics at ${origin}`, () => {
    const p = fixture('plain', true);
    for (const k of p.layers[0].keys)
      for (const s of k.shapes) {
        s.x += origin;
        s.y += origin;
      }
    const l = operation(p);
    equivalent(p, l);
  });
it('rejects a real late library edit after the complete split bank candidate exists', () => {
  const p = fixture('plain', true),
    scope = capture(() => ({ project: p, revision: 0, frame: 4 })),
    owner = scope.resolve('track', 'outer'),
    clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      q = v as Project;
    if (
      q?.layers?.[0]?.liveMotionSpans?.length === 2 &&
      q.layers[0].liveMotionSpans[0].groupPaths &&
      !fired
    ) {
      fired = true;
      p.symbols![0].name += ' late';
    }
    return out;
  });
  expect(() => prepare([{ owner, rightSpanId: 'right' }])).toThrow(/source.*changed|stale/i);
  expect(fired).toBe(true);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  scope.dispose();
});
it('rejects forged restricted bank output without publishing keys', () => {
  const p = fixture(),
    scope = capture(() => ({ project: p, revision: 0, frame: 4 })),
    owner = scope.resolve('track', 'outer'),
    clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      layer = out as Layer;
    if (layer?.liveMotionSpans?.length === 2 && layer.keys?.some((k) => k.frame === 4) && !fired) {
      fired = true;
      layer.liveMotionSpans[0].groupPaths![0].path.startX += 3;
    }
    return out;
  });
  expect(() => prepare([{ owner, rightSpanId: 'right' }])).toThrow(
    /clone changed|candidate changed/,
  );
  expect(fired).toBe(true);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  scope.dispose();
});
it('admits a curved geometry ease with independent channel easing preserved', () => {
  const p = fixture('affine', true, 'outer', {
      kind: 'cubic',
      x1: 0.25,
      y1: 0.1,
      x2: 0.75,
      y2: 0.9,
    }),
    l = operation(p);
  equivalent(p, l);
  expect(l.liveMotionSpans![0].opacityEase).not.toBeUndefined();
  expect(l.liveMotionSpans![0].paintEase).not.toBeUndefined();
});

it('restricts all-banked groups without inventing an unbanked shared reference', () => {
  const p = fixture('plain', true),
    l = p.layers[0];
  for (const k of l.keys) k.shapes = k.shapes.filter((s) => s.id !== 'loose');
  for (const s of l.keys[1].shapes.filter((s) => s.groups?.[0] === 'second')) s.x += 24;
  l.liveMotionSpans![0].groupPaths = [
    ...l.liveMotionSpans![0].groupPaths!,
    {
      groupId: 'second',
      composition: 'additive',
      path: { startX: 6, startY: 15, endX: -8, endY: 9 },
    },
  ];
  equivalent(p, operation(p));
});
it('restricts a stationary-endpoint group with a nonstationary independent excursion', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes = structuredClone(p.layers[0].keys[0].shapes);
  const l = operation(p);
  equivalent(p, l);
  expect(l.keys[1].shapes[0].y).not.toBe(p.layers[0].keys[0].shapes[0].y);
});

it('subdivides an independently eased group without retiming its neighbor or loose artwork', () => {
  const p = fixture('affine', false, 'outer', 'in'), span = p.layers[0].liveMotionSpans![0];
  const outer = span.groupPaths![0];
  span.groupPaths = [outer, {...structuredClone(outer), groupId:'second'}];
  const original = createMotionFrameSampler(p, 'track', span);
  const before = original.sample(4);
  original.dispose();
  outer.ease = {kind:'cubic',x1:1/3,y1:0,x2:2/3,y2:1/3};
  const reopened = migrateProject(JSON.parse(JSON.stringify(p)));
  const timed = createMotionFrameSampler(reopened, 'track', reopened.layers[0].liveMotionSpans![0]);
  const after = timed.sample(4);
  // Global ease-in reaches 1/4; this group then reaches 1/16 on its cubic.
  const u=1/16, x=3*(1-u)**2*u*13+3*(1-u)*u*u*71+80*u**3;
  expect(after[0].x).toBeCloseTo(x,9);
  expect(after[1].x).toBeCloseTo(40+x,9);
  expect(after.slice(2)).toEqual(before.slice(2));
  timed.dispose();
  equivalent(reopened,operation(reopened,3));
});

it('composes group easing with shared distance timing on every interior frame',()=>{
  const p=fixture('reflected',true,'outer','in'), layer=p.layers[0], span=layer.liveMotionSpans![0];
  span.path!.distance=true;
  const group=span.groupPaths![0];
  group.ease='out';
  const before=structuredClone(p), sampler=createMotionFrameSampler(p,layer.id,span);
  const start={x:0,y:0}, end={x:80,y:16};
  const shared=createMotionPathSampler(start,end,span.path!), local=createMotionPathSampler(start,end,group.path);
  try {
    for(let frame=1;frame<8;frame++){
      const t=(frame/8)**2, base=shared(t), extra=local(1-(1-t)**2);
      const shapes=sampler.sample(frame);
      for(const [i,shape] of shapes.entries()){
        const source=layer.keys[0].shapes[i], selected=source.groups?.[0]==='outer';
        expect(shape.x).toBeCloseTo(source.x+base.x+(selected?extra.x-80*t:0),9);
        expect(shape.y).toBeCloseTo(source.y+base.y+(selected?extra.y-16*t:0),9);
      }
    }
  } finally { sampler.dispose(); }
  expect(()=>operation(p)).toThrow();
  expect(p).toEqual(before);
});

it('preserves the two clocks at a shared straight corner and through a later cut',()=>{
  const p=fixture('reflected',true), layer=p.layers[0], span=layer.liveMotionSpans![0];
  span.path!.waypoints=[{x:27,y:44}];
  span.groupPaths![0].ease='in';
  const before=structuredClone(p);
  expect(()=>operation(p,3)).toThrow();
  const cut=operation(p);
  equivalent(p,cut);
  const promoted=cut.keys.find(k=>k.frame===4)!.shapes[0];
  const local=createMotionPathSampler({x:0,y:0},{x:80,y:16},span.groupPaths![0].path)(0.25);
  expect(promoted.x).toBeCloseTo(layer.keys[0].shapes[0].x+27+local.x-40,10);
  expect(promoted.y).toBeCloseTo(layer.keys[0].shapes[0].y+44+local.y-8,10);
  const q={...p,layers:[cut]};
  equivalent(p,split(q,cut,cut.liveMotionSpans![1],6,'later'));
  expect(p).toEqual(before);
});

it('follows distance across two shared corners while only the chosen group eases',()=>{
  const p=fixture('affine',true), layer=p.layers[0], span=layer.liveMotionSpans![0];
  span.path={startX:0,startY:0,endX:0,endY:0,waypoints:[{x:0,y:32},{x:80,y:32}],distance:true};
  const group=span.groupPaths![0];
  group.ease='in';
  const local=createMotionPathSampler({x:0,y:0},{x:80,y:16},group.path);
  const sampler=createMotionFrameSampler(p,layer.id,span);
  try {
    for(let frame=1;frame<8;frame++){
      const t=frame/8, distance=128*t;
      const x=Math.max(0,Math.min(80,distance-32));
      const y=distance<32 ? distance : distance<=112 ? 32 : 144-distance;
      const extra=local(t*t);
      for(const [index,shape] of sampler.sample(frame).entries()){
        const start=layer.keys[0].shapes[index], selected=start.groups?.[0]==='outer';
        expect(shape.x).toBeCloseTo(start.x+x+(selected?extra.x-80*t:0),10);
        expect(shape.y).toBeCloseTo(start.y+y+(selected?extra.y-16*t:0),10);
      }
    }
  } finally { sampler.dispose(); }
});

it('rejects unsupported waypoint and dual-distance combinations and malformed timing controls', () => {
  const p=fixture(), span=p.layers[0].liveMotionSpans![0], bank=span.groupPaths![0];
  bank.ease='in';
  span.path={...bank.path,distance:true};
  validateProject(p);
  span.path.waypoints = [{x:20,y:30}];
  validateProject(p);
  span.path.curvedWaypoints=true;
  expect(()=>validateProject(p)).toThrow(/straight waypoints/);
  delete span.path;
  bank.path.distance=true;
  validateProject(p);
  span.path={startX:10,startY:0,endX:-10,endY:0};
  expect(()=>validateProject(p)).toThrow(/absent shared route/);
  delete span.path;
  bank.path.distance=false;
  bank.ease={kind:'cubic',x1:0,y1:NaN,x2:1,y2:1};
  expect(()=>validateProject(p)).toThrow();
  let reads=0;
  Object.defineProperty(bank.ease,'y1',{enumerable:true,get(){reads++;return 0;}});
  expect(()=>validateProject(p)).toThrow();
  expect(reads).toBe(0);
});

it('preserves both clocks through recursive splits of a group beside a shared cubic', () => {
  const p=fixture('reflected',true,'outer','in'), layer=p.layers[0], span=layer.liveMotionSpans![0];
  const bank=span.groupPaths![0];
  bank.ease='in';
  equivalent(p,operation(p,3));
  const first=operation(p,4);
  equivalent(p,first);
  const q=migrateProject(JSON.parse(JSON.stringify({...p,layers:[first]})));
  const half=q.layers[0].liveMotionSpans![0];
  expect(half.groupPaths![0].spanClockOffset).toBeDefined();
  equivalent(p, split(q,q.layers[0],half,2,'second-quarter'));
  const bad=structuredClone(q);
  bad.layers[0].liveMotionSpans![0].groupPaths![0].spanClockOffset!.x=Infinity;
  expect(()=>validateProject(bad)).toThrow();
});

for (const curved of [false,true]) it(`preserves an independently eased waypoint route and recursive poses, curved=${curved}`, () => {
  const p = fixture('reflected'), span=p.layers[0].liveMotionSpans![0], row=span.groupPaths![0];
  row.path.waypoints=[{x:32,y:32}];
  if (curved) {
    row.path.curvedWaypoints=true;
    row.path.waypointTangents=[{x:8,y:12},{x:12,y:0},{x:8,y:4}];
    row.path.waypointIncoming=[{x:-8,y:0}];
  }
  row.ease='in';
  const source=structuredClone(p), first=operation(p);
  equivalent(p,first);
  const saved=migrateProject(JSON.parse(JSON.stringify({...p,layers:[first]})));
  equivalent(p,split(saved,saved.layers[0],saved.layers[0].liveMotionSpans![0],2,'quarter'));
  expect(p).toEqual(source);
  row.path.distance=true;
  expect(()=>validateProject(p)).toThrow(/equal segment timing/);
  row.path.distance=false;
  span.path={startX:0,startY:0,endX:0,endY:0};
  expect(()=>validateProject(p)).toThrow(/absent shared route/);
});
