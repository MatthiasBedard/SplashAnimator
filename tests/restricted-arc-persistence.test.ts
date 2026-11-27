import { afterEach, expect, it, vi } from 'vitest';
import { restrictedArcProject } from './restricted-arc-project-fixture';
import { migrateProject, validateProject, type Project } from '../packages/document/src';
import { validateGroupMotionPaths } from '../packages/document/src/motion-group-paths';
import {
  captureLiveMotionTimeline,
  prepareUpdateLiveMotionSpans,
} from '../packages/animation/src/live-motion';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { saveProject, loadProject } from '../packages/document/src/storage';
import { independentGroupBankChange } from '../packages/animation/src/independent-group-bank-edit';
import {
  captureLiveIndependentGroupCubicControls as captureControls,
  prepareLiveIndependentGroupCubicControlPositions as editControl,
} from '../packages/animation/src/live-independent-group-cubic-controls';
import {
  captureLiveGroupMotionAuthoringFrame,
  prepareLiveGroupRestrictedArcGeometry,
  prepareSplitLiveGroupMotionSpans,
} from '../packages/animation/src/live-group-motion-owner';
afterEach(() => vi.unstubAllGlobals());
const bank = (p: Project) => p.layers[0].liveMotionSpans![0].groupPaths![0];
for (const basis of ['plain', 'affine', 'reflected'])
  it(`reopens explicit ${basis} original-window timing with all integer artwork preserved`, () => {
    const { p, q } = restrictedArcProject(basis),
      before = structuredClone(q),
      a = captureLiveMotionTimeline(() => ({ project: p, revision: 0 })),
      reopened = migrateProject(JSON.parse(JSON.stringify(q))),
      b = captureLiveMotionTimeline(() => ({ project: reopened, revision: 0 }));
    for (let f = 0; f < p.duration; f++)
      expect(
        sameMotionArtwork(
          a.sample(f).map((track) => track.key.shapes),
          b.sample(f).map((track) => track.key.shapes),
        ),
        `frame ${f}`,
      ).toBe(true);
    a.dispose();
    b.dispose();
    expect(reopened).toEqual(before);
    expect(q).toEqual(before);
  });
for (const schemaVersion of [0, 38, 53, 54, 55, 56])
  it(`rejects forward original timing before schema ${schemaVersion} migration`, () => {
    const { q } = restrictedArcProject();
    expect(() => migrateProject({ ...q, schemaVersion })).toThrow(/schema 57/);
  });
it('upgrades a metadata-free schema56 without materializing timing defaults', () => {
  const { p } = restrictedArcProject(),
    q = migrateProject({ ...p, schemaVersion: 56 });
  expect(q).toEqual(p);
  expect(Object.hasOwn(bank(q), 'restrictedArc')).toBe(false);
});
it('preserves original timing through a checked property-channel refresh without enabling options', () => {
  const { q } = restrictedArcProject(),
    before = structuredClone(q);
  const out = prepareUpdateLiveMotionSpans(q, [
    { layerId: 'track', spanId: 'live', changes: { paintEase: 'out' } },
  ]);
  expect(out.layers[0].liveMotionSpans![0].groupPaths).toEqual(
    before.layers[0].liveMotionSpans![0].groupPaths,
  );
  expect(out.layers[0].liveMotionSpans![0].options).toEqual(
    before.layers[0].liveMotionSpans![0].options,
  );
  expect(out.layers[0].keys).toEqual(before.layers[0].keys);
  expect(out.symbols).toEqual(before.symbols);
  expect(q).toEqual(before);
});
it('roundtrips current directory and refuses an older manifest before consuming it', async () => {
  const { q } = restrictedArcProject(),
    files = new Map<string, string>();
  const store = {
    read: async (p: string) => files.get(p)!,
    exists: async (p: string) => files.has(p),
    writeNew: async (p: string, s: string) => {
      files.set(p, s);
    },
    commit: async (p: string, s: string) => {
      files.set(p, s);
    },
  };
  const raw = await saveProject(store, q, null),
    m = JSON.parse(raw);
  expect(m.schemaVersion).toBe(59);
  expect((await loadProject(store)).project).toEqual(q);
  files.set('project.json', JSON.stringify({ ...m, schemaVersion: 56 }));
  await expect(loadProject(store)).rejects.toThrow(/schema 58/);
  files.set('project.json', JSON.stringify({ ...m, schemaVersion: 56, document: { ...m.document, schemaVersion: 57 } }));
  await expect(loadProject(store)).rejects.toThrow(/schema 57/);
  files.set(
    'project.json',
    JSON.stringify({ ...m, schemaVersion: 56, document: { ...m.document, schemaVersion: 56 } }),
  );
  await expect(loadProject(store)).rejects.toThrow(/schema 57/);
  const bad = structuredClone(q);
  bank(bad).path.endY++;
  const size = files.size;
  await expect(saveProject(store, bad, raw)).rejects.toThrow(/changed/);
  expect(files.size).toBe(size);
});
it('loads an actual old56 directory and saves its absent timing unchanged under57', async () => {
  const { p } = restrictedArcProject(),
    files = new Map<string, string>();
  const store = {
    read: async (p: string) => files.get(p)!,
    exists: async (p: string) => files.has(p),
    writeNew: async (p: string, s: string) => {
      files.set(p, s);
    },
    commit: async (p: string, s: string) => {
      files.set(p, s);
    },
  };
  const raw = await saveProject(store, p, null),
    m = JSON.parse(raw);
  const old = JSON.stringify({
    ...m,
    schemaVersion: 56,
    document: { ...m.document, schemaVersion: 56 },
  });
  files.set('project.json', old);
  const reopened = (await loadProject(store)).project;
  expect(reopened).toEqual(p);
  const next = JSON.parse(await saveProject(store, reopened, old));
  expect(next.schemaVersion).toBe(59);
  expect(Object.hasOwn(bank(reopened), 'restrictedArc')).toBe(false);
});
for (const kind of [
  'start',
  'end',
  'endpoint',
  'origin',
  'window',
  'cubic',
  'basis',
  'member',
] as const)
  it(`rejects stale ${kind} at the document/save boundary`, () => {
    const { q } = restrictedArcProject();
    const b = bank(q);
    if (kind === 'start') b.path.startX++;
    if (kind === 'end') b.path.endY++;
    if (kind === 'endpoint')
      for (const s of q.layers[0].keys.find((k) => k.frame === 4)!.shapes) s.x++;
    if (kind === 'origin') b.restrictedArc!.origin.y++;
    if (kind === 'window') b.restrictedArc!.descriptor.to = 0.4;
    if (kind === 'cubic') b.restrictedArc!.descriptor.cubic[2].x++;
    if (kind === 'basis') q.layers[0].keys[1].shapes[0].transform![0]++;
    if (kind === 'member') q.layers[0].keys[1].shapes[1].x++;
    expect(() => validateProject(q)).toThrow();
  });
for (const kind of [
  'getter',
  'sparse',
  'extra',
  'nan',
  'infinity',
  'version',
  'zero',
  'undefined',
  'wrong-path',
  'shared',
] as const)
  it(`rejects original malformed timing ${kind} without reading getters`, () => {
    const { q } = restrictedArcProject(),
      b = bank(q);
    let reads = 0;
    if (kind === 'getter')
      Object.defineProperty(b.restrictedArc!.descriptor, 'from', {
        enumerable: true,
        get() {
          reads++;
          return 0;
        },
      });
    if (kind === 'sparse') delete (b.restrictedArc!.descriptor.cubic as unknown as unknown[])[1];
    if (kind === 'extra') Object.assign(b.restrictedArc!.origin, { extra: 1 });
    if (kind === 'nan') b.restrictedArc!.origin.x = NaN;
    if (kind === 'infinity') b.restrictedArc!.descriptor.cubic[1].y = Infinity;
    if (kind === 'version') Object.assign(b.restrictedArc!.descriptor, { version: 2 });
    if (kind === 'zero') b.restrictedArc!.descriptor.cubic[0].x = 1;
    if (kind === 'undefined') Object.assign(b, { restrictedArc: undefined });
    if (kind === 'wrong-path') {
      Object.assign(b.path, { restrictedArc: b.restrictedArc });
      delete b.restrictedArc;
    }
    if (kind === 'shared')
      q.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 0, endX: 0, endY: 0 };
    expect(() => validateProject(q)).toThrow();
    expect(reads).toBe(0);
  });
it('does not invoke a forward-field getter while rejecting old-schema source', () => {
  const { p } = restrictedArcProject();
  let reads = 0;
  Object.defineProperty(bank(p), 'restrictedArc', {
    enumerable: true,
    get() {
      reads++;
      return undefined;
    },
  });
  expect(() => migrateProject({ ...p, schemaVersion: 56 })).toThrow(/schema 57/);
  expect(reads).toBe(0);
});
it('rejects a forward field hidden under an enumerable symbol key before old migration drops it',()=>{
  const {p,q}=restrictedArcProject();
  Object.assign(p,{[Symbol('forward')]:{restrictedArc:bank(q).restrictedArc}});
  expect(()=>migrateProject({...p,schemaVersion:56})).toThrow(/schema 57/);
});
for (const role of ['start', 'end'] as const)
  it(`explicit checked ${role} edits discard only the selected bank timing`, () => {
    const { q } = restrictedArcProject(),
      before = structuredClone(q),
      scope = captureControls(() => ({ project: q, revision: 0, frame: 2 })),
      owner = scope.resolve('track', 'live', 'outer', role);
    expect(() => editControl([{ owner, target: { ...owner.point } }])).toThrow(/unchanged/);
    const out = editControl([{ owner, target: { x: owner.point.x + 4, y: owner.point.y + 4 } }]);
    scope.dispose();
    expect(bank(out).restrictedArc).toBeUndefined();
    expect(bank(out).path.distance).toBe(true);
    expect(out.layers[0].liveMotionSpans![0].groupPaths![1]).toEqual(
      before.layers[0].liveMotionSpans![0].groupPaths![1],
    );
    expect(out.layers[0].liveMotionSpans![1]).toEqual(before.layers[0].liveMotionSpans![1]);
    expect(q).toEqual(before);
    validateProject(out);
  });
it('bank set invalidates timing only for a meaningful explicit control change', () => {
  const { q } = restrictedArcProject(),
    b = bank(q),
    start = q.layers[0].keys[0].shapes[0],
    end = q.layers[0].keys[1].shapes[0];
  const points = {
    startX: start.x + b.path.startX,
    startY: start.y + b.path.startY,
    endX: end.x + b.path.endX,
    endY: end.y + b.path.endY,
  };
  expect(() => independentGroupBankChange(q, 'track', 'live', 'outer', 'set', points)).toThrow(
    /unchanged/,
  );
  const changed = independentGroupBankChange(q, 'track', 'live', 'outer', 'set', {
    ...points,
    startY: points.startY + 4,
  })!;
  expect(changed[0].restrictedArc).toBeUndefined();
  expect(changed[1]).toEqual(q.layers[0].liveMotionSpans![0].groupPaths![1]);
});
it('generic updates cannot reuse stale timing and failed later requests stay atomic', () => {
  const { q } = restrictedArcProject(),
    before = structuredClone(q),
    changed = structuredClone(q.layers[0].liveMotionSpans![0].groupPaths!);
  changed[0].path.startY++;
  expect(() =>
    prepareUpdateLiveMotionSpans(q, [
      { layerId: 'track', spanId: 'live', changes: { ease: 'in' } },
      { layerId: 'track', spanId: 'right', changes: { groupPaths: changed } },
    ]),
  ).toThrow();
  expect(q).toEqual(before);
});
it('generic subdivision and staging reject persisted timing until recursive candidate proof exists', () => {
  const { q } = restrictedArcProject(),
    scope = captureLiveGroupMotionAuthoringFrame(() => ({ project: q, revision: 0, frame: 2 })),
    owner = scope.resolve('track', 'outer');
  expect(() => prepareLiveGroupRestrictedArcGeometry([owner])).toThrow(/recursive/);
  expect(() => prepareSplitLiveGroupMotionSpans([{ owner, rightSpanId: 'unsafe' }])).toThrow(
    /candidate admission/,
  );
  scope.dispose();
});
it('validates timing raw arrays before transport can hide malformed descriptor fields', () => {
  const { q } = restrictedArcProject(),
    b = bank(q);
  Object.defineProperty(b.restrictedArc!.descriptor.cubic, 'extra', { value: true });
  expect(() => validateGroupMotionPaths([b])).toThrow();
});
for(const place of ['project','layer','key','shape','symbol'] as const)
  it(`rejects timing placed on a ${place} instead of its group binding`,()=>{
    const {q}=restrictedArcProject();const row=place==='project'?q:place==='layer'?q.layers[0]:place==='key'?q.layers[0].keys[0]:place==='shape'?q.layers[0].keys[0].shapes[0]:q.symbols![0];
    Object.assign(row,{restrictedArc:structuredClone(bank(q).restrictedArc)});
    expect(()=>validateProject(q)).toThrow(/restricted arc/i);
  });
