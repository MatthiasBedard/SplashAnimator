import { afterEach, expect, it, vi } from 'vitest';
import {
  validateProject,
  migrateProject,
  type Project,
  type LiveMotionSpan,
} from '../packages/document/src';
import {
  validateGroupMotionPaths,
  type GroupMotionPath,
} from '../packages/document/src/motion-group-paths';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { captureIndependentGroupTrajectories } from '../packages/animation/src/independent-group-trajectories';
import {
  captureLiveMotionTimeline,
  prepareUpdateLiveMotionSpans,
  prepareCreateLiveMotionSpans,
} from '../packages/animation/src/live-motion';
import { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
import { captureLiveMotionStage } from '../packages/animation/src/live-motion-stage';
import { splitLiveGroupMotionLayer } from '../packages/animation/src/live-group-motion-split';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import { saveProject, loadProject } from '../packages/document/src/storage';
afterEach(() => vi.unstubAllGlobals());
function fixture(basis = 'plain', two = false) {
  const { p } = liveRotationFixture('rigid', basis, true);
  const l = p.layers[0];
  l.keys[1].shapes = l.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 80,
    y: s.y + 16,
  }));
  l.liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  if (two) secondRotationTrack(p);
  return p;
}
const route = (groupId = 'outer'): GroupMotionPath => ({
  groupId,
  composition: 'additive',
  path: { startX: 0, startY: -40, endX: 0, endY: -40 },
});
const update = (p: Project, bank: readonly GroupMotionPath[] | undefined) =>
  prepareUpdateLiveMotionSpans(p, [
    { layerId: 'track', spanId: 'live', changes: { groupPaths: bank } },
  ]);
for (const basis of ['plain', 'affine', 'reflected'])
  for (const group of ['outer', 'second'])
    it(`persists ${group}/${basis} with exact independent versus shared sampling`, () => {
      const p = fixture(basis),
        before = structuredClone(p),
        bank = [route(group)],
        q = update(p, bank),
        expected = captureIndependentGroupTrajectories(
          () => ({ project: p, revision: 0 }),
          [{ layerId: 'track', spanId: 'live', ...bank[0] }],
        );
      const sampler = captureLiveMotionTimeline(() => ({ project: q, revision: 0 }));
      for (let f = 0; f < p.duration; f++) expect(sampler.sample(f)).toEqual(expected.sample(f));
      expect(p).toEqual(before);
      expect(q.layers[0].keys).toEqual(p.layers[0].keys);
      expect(q.symbols).toEqual(p.symbols);
      expect(migrateProject(JSON.parse(JSON.stringify(q)))).toEqual(q);
      sampler.dispose();
      expected.dispose();
    });
it('roundtrips current-schema manifest and rejects an older manifest wrapper', async () => {
  const p = update(fixture(), [route()]),
    files = new Map<string, string>();
  const store = {
    read: async (path: string) => files.get(path)!,
    exists: async (path: string) => files.has(path),
    writeNew: async (path: string, text: string) => {
      files.set(path, text);
    },
    commit: async (path: string, text: string) => {
      files.set(path, text);
    },
  };
  const raw = await saveProject(store, p, null),
    m = JSON.parse(raw);
  expect(m.schemaVersion).toBe(59);
  expect((await loadProject(store)).project).toEqual(p);
  files.set('project.json', JSON.stringify({ ...m, schemaVersion: 55 }));
  await expect(loadProject(store)).rejects.toThrow(/schema 58/i);
});
it('migrates schema 55 without materializing group paths', () => {
  const p = fixture(),
    old = { ...p, schemaVersion: 55 };
  const q = migrateProject(old);
  expect(q).toEqual(p);
  expect(Object.hasOwn(q.layers[0].liveMotionSpans![0], 'groupPaths')).toBe(false);
});
it('rejects a forward field in every older live schema', () => {
  const p = update(fixture(), [route()]);
  for (const schemaVersion of [54, 55])
    expect(() => migrateProject({ ...p, schemaVersion })).toThrow(/schema 56/);
});
it('removes an explicit bank without altering the original shared route', () => {
  const base = fixture(),
    p = update(base, [route()]),
    q = update(p, undefined);
  expect(q).toEqual(base);
  expect(p.layers[0].liveMotionSpans![0].groupPaths).toHaveLength(1);
});
it('creates sparse routes atomically without generated keys', () => {
  const p = fixture(),
    span = { ...structuredClone(p.layers[0].liveMotionSpans![0]), groupPaths: [route()] };
  delete p.layers[0].liveMotionSpans;
  const q = prepareCreateLiveMotionSpans(p, [{ layerId: 'track', span }]);
  expect(q.layers[0].keys).toEqual(p.layers[0].keys);
  expect(q.layers[0].liveMotionSpans![0].groupPaths).toEqual([route()]);
});
it('prepares all tracks before rejecting a later incomplete group', () => {
  const p = fixture('plain', true),
    before = structuredClone(p);
  expect(() =>
    prepareUpdateLiveMotionSpans(p, [
      { layerId: 'track', spanId: 'live', changes: { groupPaths: [route()] } },
      { layerId: 'later', spanId: 'live', changes: { groupPaths: [route('missing')] } },
    ]),
  ).toThrow();
  expect(p).toEqual(before);
});
it('rejects unqualified distance-bank restriction', () => {
  const p = update(fixture(), [route()]),
    l = p.layers[0];
  l.liveMotionSpans![0].groupPaths![0].path.distance = true;
  expect(() => splitLiveGroupMotionLayer(p, l, l.liveMotionSpans![0], 4, 'right')).toThrow(
    /restriction/,
  );
});
it('source-owned stage and detached export frame share the persisted route', async () => {
  const p = update(fixture('reflected'), [route()]),
    before = structuredClone(p),
    read = () => ({ project: p, revision: 0 }),
    view = captureLiveMotionStage(read),
    sampler = captureLiveMotionTimeline(read);
  const expected = sampler.sample(4)[0].key.shapes,
    stage = view.sample(4),
    render = await prepareLiveMotionFrameCapture(read, 4);
  expect(stage.project.layers[0].keys.find((k) => k.frame === 4)!.shapes).toEqual(expected);
  expect(render.layers[0].keys.find((k) => k.frame === 4)!.shapes).toEqual(expected);
  expect(p).toEqual(before);
  view.dispose();
  sampler.dispose();
});
for (const mode of [
  'NaN',
  'Infinity',
  'getter',
  'prototype',
  'hidden',
  'sparse',
  'extra',
  'missing',
  'duplicate',
  'composition',
  'point getter',
  'point missing',
  'path field',
])
  it(`rejects raw ${mode} before transport without evaluating accessors`, () => {
    const p = fixture(),
      before = structuredClone(p),
      bank = [route()];
    let reads = 0;
    if (mode === 'NaN') bank[0].path.startX = NaN;
    if (mode === 'Infinity') bank[0].path.endX = Infinity;
    if (mode === 'getter')
      Object.defineProperty(bank[0], 'path', {
        enumerable: true,
        get() {
          reads++;
          return route().path;
        },
      });
    if (mode === 'prototype') Object.setPrototypeOf(bank[0], { path: route().path });
    if (mode === 'hidden')
      Object.defineProperty(bank[0], 'composition', { enumerable: false, value: 'additive' });
    if (mode === 'sparse') bank.length = 2;
    if (mode === 'extra') Object.assign(bank[0], { x: 1 });
    if (mode === 'missing') delete (bank[0] as Partial<GroupMotionPath>).groupId;
    if (mode === 'duplicate') bank.push(route());
    if (mode === 'composition') bank[0].composition = 'replace' as 'additive';
    if (mode === 'point getter' || mode === 'point missing') {
      const point = { x: 20, y: 30 };
      bank[0].path.waypoints = [point];
      if (mode === 'point getter')
        Object.defineProperty(point, 'x', {
          enumerable: true,
          get() {
            reads++;
            return 20;
          },
        });
      else delete (point as Partial<typeof point>).x;
    }
    if (mode === 'path field') Object.assign(bank[0].path, { other: 1 });
    expect(() => update(p, bank)).toThrow();
    expect(reads).toBe(0);
    expect(p).toEqual(before);
  });
it('raw document validation rejects a group bank accessor before ordinary field reads', () => {
  const p = fixture();
  let reads = 0;
  Object.defineProperty(p.layers[0].liveMotionSpans![0], 'groupPaths', {
    enumerable: true,
    get() {
      reads++;
      return [route()];
    },
  });
  expect(() => validateProject(p)).toThrow();
  expect(reads).toBe(0);
});
it('sampler snapshots controls and preserves exact authored endpoints', () => {
  const p = update(fixture(), [route()]),
    l = p.layers[0],
    span = l.liveMotionSpans![0],
    sampler = createMotionFrameSampler(p, l.id, span),
    mid = sampler.sample(4);
  span.groupPaths![0].path.startY = 300;
  expect(sampler.sample(4)).toEqual(mid);
  expect(sampler.sample(0)).toEqual(l.keys[0].shapes);
  sampler.dispose();
});
it('rejects forged route clones rather than applying altered controls', () => {
  const p = update(fixture(), [route()]),
    clone = structuredClone;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v) as LiveMotionSpan;
    if (out?.groupPaths) out.groupPaths[0].path.startY = 300;
    return out;
  });
  expect(() => createMotionFrameSampler(p, 'track', p.layers[0].liveMotionSpans![0])).toThrow(
    /clone changed|source changed/,
  );
});
for (const mode of ['tangent', 'rotation', 'displacement', 'basis', 'unknown group'])
  it(`retains geometry admission for ${mode}`, () => {
    const p = fixture(),
      bank = [route()];
    if (mode === 'tangent') bank[0].path.tangent = true;
    if (mode === 'rotation') p.layers[0].keys[1].shapes[0].rotation = 90;
    if (mode === 'displacement') p.layers[0].keys[1].shapes[1].x++;
    if (mode === 'basis') p.layers[0].keys[1].shapes[0].transform = [2, 0, 0, 2];
    if (mode === 'unknown group') bank[0].groupId = 'missing';
    expect(() => update(p, bank)).toThrow();
  });
it('validates empty banks but retains their explicit serialized meaning', () => {
  validateGroupMotionPaths([]);
  const p = fixture(),
    q = update(p, []);
  expect(q.layers[0].liveMotionSpans![0].groupPaths).toEqual([]);
  const a = captureLiveMotionTimeline(() => ({ project: p, revision: 0 })),
    b = captureLiveMotionTimeline(() => ({ project: q, revision: 0 }));
  expect(a.sample(4)).toEqual(b.sample(4));
  a.dispose();
  b.dispose();
});

it('rejects independent banks on remembered baked recipes', () => {
  const p = fixture(),
    l = p.layers[0],
    span = { ...l.liveMotionSpans![0], baseline: 'old', groupPaths: [route()] };
  delete l.liveMotionSpans;
  l.motionSpans = [span];
  expect(() => validateProject(p)).toThrow(/sparse live spans/);
  expect(() => createMotionFrameSampler(p, l.id, span)).toThrow(/sparse live recipe/);
});
it('rejects a transient duplicate of an already persisted original group route', () => {
  const p = update(fixture(), [route()]);
  expect(() =>
    captureIndependentGroupTrajectories(
      () => ({ project: p, revision: 0 }),
      [{ layerId: 'track', spanId: 'live', ...route() }],
    ),
  ).toThrow(/already owns/);
});
it('rejects a real late library edit after the full bank candidate was cloned', () => {
  const p = fixture(),
    clone = structuredClone;
  let fired = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      q = v as Project;
    if (q?.layers?.[0]?.liveMotionSpans?.[0]?.groupPaths && !fired) {
      fired = true;
      p.symbols![0].name += ' late';
    }
    return out;
  });
  expect(() => update(p, [route()])).toThrow(/source.*changed/i);
  expect(fired).toBe(true);
  expect(p.layers[0].liveMotionSpans![0].groupPaths).toBeUndefined();
});
