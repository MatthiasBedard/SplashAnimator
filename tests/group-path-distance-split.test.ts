import { afterEach, expect, it, vi } from 'vitest';
import { independentGroupBankChange } from '../packages/animation/src/independent-group-bank-edit';
import { splitRestrictedArcLiveGroupMotionLayer, splitRecursiveRestrictedArcLiveGroupMotionLayer } from '../packages/animation/src/live-group-motion-split';
import { captureCubicDistanceCorrespondence, motionPathPosition } from '../packages/animation/src/motion-path';
import { liveRotationFixture } from './live-motion-rotation-fixture';
import { splitLiveGroupMotionLayer as split } from '../packages/animation/src/live-group-motion-split';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { validateProject, migrateProject, type Project } from '../packages/document/src';
import {
  captureLiveGroupMotionAuthoringFrame as capture,
  prepareSplitLiveGroupMotionSpans as prepare,
} from '../packages/animation/src/live-group-motion-owner';
import { secondRotationTrack } from './live-motion-rotation-fixture';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fixture(curve = true, basis = 'plain', coincident = false) {
  const { p } = liveRotationFixture('rigid', basis, true),
    l = p.layers[0];
  l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 96,
    y: s.y + 24,
  }));
  delete l.liveMotionSpans![0].path;
  if (coincident)
    for (const key of l.keys.slice(0, 2))
      for (const group of ['outer', 'second']) {
        const a = key.shapes.filter((s) => s.groups?.[0] === group);
        a[1].x = a[0].x;
        a[1].y = a[0].y;
      }
  l.liveMotionSpans![0].groupPaths = ['outer', 'second'].map((groupId) => ({
    groupId,
    composition: 'additive',
    path: {
      startX: 32,
      startY: curve ? -40 : 8,
      endX: -32,
      endY: curve ? -24 : -8,
      distance: true,
      tangent: false,
    },
  }));
  return p;
}
for (const curve of [false])
  for (const coincident of [false, true])
    for (const at of [2, 4, 6])
      it(`restricts distance cubic curve${curve}/coincident${coincident}/at${at}`, () => {
        const p = fixture(curve, 'plain', coincident),
          l = p.layers[0],
          before = structuredClone(p),
          out = split(p, l, l.liveMotionSpans![0], at, 'right'),
          q = { ...p, layers: [out] },
          source = createMotionFrameSampler(p, l.id, l.liveMotionSpans![0]),
          plans = out.liveMotionSpans!.map((s) => createMotionFrameSampler(q, l.id, s));
        try {
          for (let f = 0; f <= 8; f++) {
            const i = out.liveMotionSpans!.findIndex((s) => s.start <= f && s.end >= f);
            expect(sameMotionArtwork(source.sample(f), plans[i].sample(f)), `frame ${f}`).toBe(
              true,
            );
          }
        } finally {
          source.dispose();
          plans.forEach((s) => s.dispose());
        }
        expect(p).toEqual(before);
      });

for (const coincident of [false, true])
  for (const height of [1, 8, 16, 32])
    it(`${!coincident && [8, 16].includes(height) ? 'rejects unrepresentable' : 'restricts certified'} symmetric curve height${height}/coincident${coincident}`, () => {
      const p = fixture(true, 'reflected', coincident),
        l = p.layers[0];
      for (const [i, k] of l.keys.slice(0, 2).entries())
        if (i) for (let n = 0; n < k.shapes.length; n++) k.shapes[n].y = l.keys[0].shapes[n].y;
      for (const bank of l.liveMotionSpans![0].groupPaths!) {
        bank.path.startY = height;
        bank.path.endY = height;
      }
      const before = structuredClone(p);
      if (!coincident && [8, 16].includes(height)) {
        expect(() => split(p, l, l.liveMotionSpans![0], 4, 'right')).toThrow(
          /equal member displacement/,
        );
        expect(p).toEqual(before);
        return;
      }
      const out = split(p, l, l.liveMotionSpans![0], 4, 'right'),
        q = { ...p, layers: [out] },
        source = createMotionFrameSampler(p, l.id, l.liveMotionSpans![0]),
        plans = out.liveMotionSpans!.map((s) => createMotionFrameSampler(q, l.id, s));
      try {
        for (let f = 0; f <= 8; f++)
          expect(sameMotionArtwork(source.sample(f), plans[f <= 4 ? 0 : 1].sample(f))).toBe(true);
      } finally {
        source.dispose();
        plans.forEach((s) => s.dispose());
      }
      expect(p).toEqual(before);
    });
for (const at of [2, 4, 6])
  it(`rejects uncertifiable asymmetric arc timing at ${at} without changing original keys`, () => {
    const p = fixture(true),
      before = structuredClone(p),
      l = p.layers[0];
    expect(() => split(p, l, l.liveMotionSpans![0], at, 'right')).toThrow(/arc correspondence/);
    expect(p).toEqual(before);
  });

function allFrames(p: Project, q: Project) {
  const l = p.layers[0],
    original = createMotionFrameSampler(p, l.id, l.liveMotionSpans![0]),
    plans = q.layers[0].liveMotionSpans!.map((s) => createMotionFrameSampler(q, l.id, s));
  try {
    for (let f = 0; f <= 8; f++) {
      const i = q.layers[0].liveMotionSpans!.findIndex((s) => s.start <= f && s.end >= f);
      expect(sameMotionArtwork(original.sample(f), plans[i].sample(f)), `frame ${f}`).toBe(true);
    }
  } finally {
    original.dispose();
    plans.forEach((s) => s.dispose());
  }
}
it('retains mixed parameter/distance banks, loose roots and full original settings', () => {
  const p = fixture(false),
    s = p.layers[0].liveMotionSpans![0];
  s.groupPaths![1].path.distance = false;
  const before = structuredClone(p),
    l = split(p, p.layers[0], s, 4, 'right'),
    q = { ...p, layers: [l] };
  allFrames(p, q);
  expect(p).toEqual(before);
  for (const half of l.liveMotionSpans!) {
    expect(half.groupPaths![0].path.distance).toBe(true);
    expect(half.groupPaths![1].path.distance).toBe(false);
    expect(half.options).toEqual(s.options);
    expect(Object.hasOwn(half, 'path')).toBe(false);
  }
  expect(l.keys[0]).toEqual(p.layers[0].keys[0]);
  expect(l.keys[2]).toEqual(p.layers[0].keys[1]);
  expect(l.keys[3]).toEqual(p.layers[0].keys[2]);
});
it('retains recursive restrictions and JSON reopening for resolved distance banks', () => {
  const p = fixture(false);
  let q = migrateProject(
    JSON.parse(
      JSON.stringify({
        ...p,
        layers: [split(p, p.layers[0], p.layers[0].liveMotionSpans![0], 4, 'right')],
      }),
    ),
  );
  for (const at of [2, 6]) {
    const s = q.layers[0].liveMotionSpans!.find((s) => s.start < at && s.end > at)!;
    q = { ...q, layers: [split(q, q.layers[0], s, at, `part${at}`)] };
  }
  validateProject(q);
  allFrames(p, q);
  expect(q.layers[0].keys.map((k) => k.frame)).toEqual([0, 2, 4, 6, 8, 10]);
});
for (const basis of ['affine', 'reflected'])
  for (const origin of [-99000, 99000])
    it(`retains ${basis} relative numerics at ${origin}`, () => {
      const p = fixture(false, basis);
      for (const k of p.layers[0].keys)
        for (const s of k.shapes) {
          s.x += origin;
          s.y += origin;
        }
      const l = split(p, p.layers[0], p.layers[0].liveMotionSpans![0], 4, 'right');
      allFrames(p, { ...p, layers: [l] });
    });
for (const mode of ['shared', 'waypoint'] as const)
  it(`retains unqualified ${mode} distance composition rejection and valid playback`, () => {
    const p = fixture(false),
      s = p.layers[0].liveMotionSpans![0];
    if (mode === 'shared') s.path = { startX: 32, startY: 8, endX: -32, endY: -8 };
    else s.groupPaths![0].path.waypoints = [{ x: 48, y: 30 }];
    const before = structuredClone(p);
    expect(() => split(p, p.layers[0], s, 4, 'right')).toThrow(/parametric/);
    expect(p).toEqual(before);
    const sampler = createMotionFrameSampler(p, 'track', s);
    expect(sampler.sample(4)).toHaveLength(5);
    sampler.dispose();
  });
it('prepares both original tracks atomically and rejects a later uncertifiable bank', () => {
  const p = fixture(false),
    later = secondRotationTrack(p),
    scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
    requests = ['track', later.id].map((id) => ({
      owner: scope.resolve(id, 'outer'),
      rightSpanId: 'right',
    })),
    before = structuredClone(p),
    q = prepare(requests);
  allFrames(p, q);
  expect(q.layers[1].liveMotionSpans).toHaveLength(2);
  expect(p).toEqual(before);
  scope.dispose();
  later.liveMotionSpans![0].groupPaths![0].path.startY = -40;
  later.liveMotionSpans![0].groupPaths![0].path.endY = -24;
  const rejected = capture(() => ({ project: p, frame: 4, revision: 0 })),
    changed = structuredClone(p);
  expect(() =>
    prepare(
      ['track', later.id].map((id) => ({
        owner: rejected.resolve(id, 'outer'),
        rightSpanId: 'right',
      })),
    ),
  ).toThrow(/arc correspondence/);
  expect(p).toEqual(changed);
  rejected.dispose();
});
for (const action of ['source', 'library', 'reentry', 'input-clone', 'output-clone'] as const)
  it(`rejects actual ${action} in original distance preparation and allows source-valid retries`, () => {
    const p = fixture(false),
      scope = capture(() => ({ project: p, frame: 4, revision: 0 })),
      requests = [{ owner: scope.resolve('track', 'outer'), rightSpanId: 'right' }],
      clone = structuredClone;
    let fired = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        data = value as { path?: { distance?: boolean }; middle?: unknown; delta?: unknown },
        project = value as Project,
        hit =
          action === 'output-clone'
            ? project?.layers?.[0]?.liveMotionSpans?.length === 2 &&
              project.layers[0].keys.some((k) => k.frame === 4)
            : data?.path?.distance && data?.middle && data?.delta;
      if (!fired && hit) {
        fired = true;
        if (action === 'source') p.name = 'Separate source';
        if (action === 'library') p.symbols![0].name = 'Separate library';
        if (action === 'reentry')
          try {
            prepare(requests);
          } catch {
            /* Outer admission must remember swallowed reentry. */
          }
        if (action === 'input-clone') (out as { path: { startX: number } }).path.startX++;
        if (action === 'output-clone')
          (out as Project).layers[0].liveMotionSpans![0].groupPaths![0].path.startX++;
      }
      return out;
    });
    expect(() => prepare(requests)).toThrow();
    expect(fired).toBe(true);
    expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
    if (action !== 'source' && action !== 'library') {
      const q = prepare(requests);
      allFrames(p, q);
    }
    scope.dispose();
  });

for (const ease of ['in', 'out', 'in-out'] as const)
  it(`preserves ${ease} geometry easing and independent paint/opacity channels`, () => {
    const p = fixture(false),
      s = p.layers[0].liveMotionSpans![0];
    s.ease = ease;
    s.opacityEase = 'out';
    s.paintEase = 'linear';
    for (const [i, k] of p.layers[0].keys.slice(0, 2).entries()) {
      k.shapes[0].fill = i ? '#808080' : '#000000';
      k.shapes[0].opacity = i ? 1 : 0.5;
    }
    const q = { ...p, layers: [split(p, p.layers[0], s, 4, 'right')] };
    allFrames(p, q);
    expect(q.layers[0].liveMotionSpans![0].opacityEase).toBeDefined();
    expect(q.layers[0].liveMotionSpans![0].paintEase).toBeDefined();
  });

it('keeps eased distance travel on its original arc through saved and recursive key insertion', () => {
  const p = fixture(true, 'reflected', true), layer = p.layers[0], span = layer.liveMotionSpans![0];
  for (const row of span.groupPaths!) row.path = {startX:16,startY:8,endX:-16,endY:-8,distance:true};
  const bank = span.groupPaths![0];
  bank.ease = 'in';
  const first = layer.keys[0].shapes[0];
  const arc = captureCubicDistanceCorrespondence([[{x:0,y:0},{x:16,y:8},{x:80,y:16},{x:96,y:24}]]);
  const expected = motionPathPosition(first, { x:first.x+96, y:first.y+24 }, arc.parameter(0.25), bank.path);
  const source = createMotionFrameSampler(p,layer.id,span);
  try {
    const pose = source.sample(4)[0];
    expect(pose.x).toBeCloseTo(expected.x,9);
    expect(pose.y).toBeCloseTo(expected.y,9);
    const initial = splitRestrictedArcLiveGroupMotionLayer(p,layer,span,4,'right');
    const saved = migrateProject(JSON.parse(JSON.stringify({...p,layers:[initial]})));
    const left = saved.layers[0].liveMotionSpans![0];
    expect(left.groupPaths![0].restrictedArc?.descriptor.to).toBe(0.25);
    expect(left.groupPaths![1].restrictedArc?.descriptor.to).toBe(0.5);
    const old = left.groupPaths![0], end = initial.keys.find(k=>k.frame===4)!.shapes[0];
    const points = { startX:first.x+old.path.startX, startY:first.y+old.path.startY,
      endX:end.x+old.path.endX, endY:end.y+old.path.endY };
    const timing = {kind:'cubic' as const,x1:0.2,y1:0.4,x2:0.7,y2:1};
    const edited = independentGroupBankChange(saved,layer.id,left.id,'outer','set',points,timing)!;
    expect(edited[0]).toEqual({...old,ease:timing});
    expect(edited[1]).toEqual(left.groupPaths![1]);
    const recursive = splitRecursiveRestrictedArcLiveGroupMotionLayer(saved,saved.layers[0],left,2,'quarter');
    const reopened = migrateProject(JSON.parse(JSON.stringify({...saved,layers:[recursive]})));
    for (const part of reopened.layers[0].liveMotionSpans!) {
      const sampler = createMotionFrameSampler(reopened,layer.id,part);
      try {
        for (let f=part.start; f<=part.end; f++)
          expect(sameMotionArtwork(sampler.sample(f),source.sample(f))).toBe(true);
      } finally { sampler.dispose(); }
    }
  } finally { source.dispose(); }
});

it('rejects an unresolved continuous eased distance split without altering either group', () => {
  const p = fixture(true, 'reflected', true), layer=p.layers[0], span=layer.liveMotionSpans![0];
  span.groupPaths![0].ease='in';
  const original=structuredClone(p);
  expect(()=>splitRestrictedArcLiveGroupMotionLayer(p,layer,span,4,'right')).toThrow(/numerically unresolved/);
  expect(p).toEqual(original);
});
