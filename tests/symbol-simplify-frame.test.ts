import { afterEach, expect, it, vi } from 'vitest';
import { validateProject } from '../packages/document/src';
import {
  captureSymbolArtworkSimplification as capture,
  prepareSymbolArtworkSimplification as prepare,
} from '../packages/geometry/src/symbol-simplify-owner';
import {
  symbolSimplifyArtwork as artwork,
  withSymbolSimplifyArtwork as replace,
} from '../packages/geometry/src/symbol-simplify-artwork';
import {
  snapshotSymbolSimplifyRequest as snapshot,
  prepareSymbolSimplifyRequest as request,
  admitSymbolSimplifyResult as admit,
} from '../packages/geometry/src/symbol-simplify-request';
import { artworkVertices } from '../packages/geometry/src/artwork-simplify';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { createBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { symbolSimplifyFixture } from './symbol-simplify-fixture';
import { symbolSimplifyFrameFixture as fixture } from './symbol-simplify-frame-fixture';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
for (const basis of ['plain', 'affine', 'reflected'])
  for (const location of [
    { layerId: '@base', frame: 0 },
    { layerId: '@base', frame: 4 },
    { layerId: 'detail', frame: 0 },
    { layerId: 'detail', frame: 6 },
  ])
    it(`prepares only ${location.layerId}/${location.frame} under ${basis} original storage`, () => {
      const input = { ...fixture(basis, true), location },
        before = structuredClone(input),
        scope = capture(() => ({ project: input.project, revision: 0 }));
      const owner = scope.resolveFrame(input.symbolId, location, input.selected),
        out = prepare(owner),
        next = artwork(out.project.symbols![0], location),
        prior = artwork(before.project.symbols![0], location);
      expect(owner.selected).toEqual(['line', 'paint']);
      expect(Object.isFrozen(owner.location)).toBe(true);
      expect(out.removed).toBeGreaterThan(100);
      expect(out.removed).toBe(
        prior.reduce((n, s) => n + artworkVertices(s), 0) -
          next.reduce((n, s) => n + artworkVertices(s), 0),
      );
      expect(next[2]).toStrictEqual(prior[2]);
      expect(next[1].contours).toHaveLength(2);
      expect(matrix(next[0])).toEqual(matrix(prior[0]));
      for (const end of [0, -1])
        expect(mapPoint(matrix(next[0]), next[0].nodes!.at(end)!)).toEqual(
          mapPoint(matrix(prior[0]), prior[0].points.at(end)!),
        );
      const restored = structuredClone(out.project);
      restored.symbols![0] = replace(restored.symbols![0], structuredClone(prior), location);
      expect(restored).toStrictEqual(before.project);
      expect(input).toStrictEqual(before);
      const hosted = admit(snapshot(input), out);
      expect(hosted).toStrictEqual(out);
      hosted.project.symbols![0].name = 'caller mutation';
      next[0].nodes![0].x++;
      expect(input).toStrictEqual(before);
      expect(prepare(owner).project.symbols![0].name).toBe('Original art');
      scope.dispose();
    });

it('keeps static defaults exact and requires explicit animated scope', () => {
  const input = fixture(),
    scope = capture(() => ({ project: input.project, revision: 0 }));
  expect(() => scope.resolve('art', ['line'])).toThrow(/static/);
  expect(() => scope.resolveIsolated('art', ['outer'], ['line'])).toThrow(/static/);
  expect(() => snapshot({ ...input, location: undefined })).toThrow();
  const plain = symbolSimplifyFixture(),
    staticScope = capture(() => ({ project: plain.project, revision: 0 }));
  expect(() => staticScope.resolveFrame('art', { layerId: '@base', frame: 0 }, ['line'])).toThrow(
    /timeline|button/,
  );
  expect(prepare(staticScope.resolve('art', ['line']))).toStrictEqual(request(plain));
});
it('owns a static button base without inventing a timeline', () => {
  const input = symbolSimplifyFixture();
  input.project.symbols![0].buttonStates = { up: 0, over: 0, down: 0, hit: 0 };
  const out = request({ ...input, location: { layerId: '@base', frame: 0 } });
  expect(out.removed).toBeGreaterThan(0);
  expect(out.project.symbols![0].timeline).toBeUndefined();
  expect(out.project.symbols![0].buttonStates).toEqual(input.project.symbols![0].buttonStates);
});
it('owns relative complete groups inside the exact additional key', () => {
  const input = {
      ...fixture('reflected'),
      location: { layerId: 'detail', frame: 6 },
      ancestry: ['outer'],
    },
    before = structuredClone(input);
  const scope = capture(() => ({ project: input.project, revision: 0 })),
    owner = scope.resolveFrame('art', input.location, ['line'], input.ancestry);
  expect(owner.selected).toEqual(['line']);
  expect(owner.ancestry).toEqual(['outer']);
  const out = request(input),
    next = artwork(out.project.symbols![0], input.location);
  expect(next[0].groups).toEqual(['outer', 'inner']);
  expect(next.slice(1)).toStrictEqual(artwork(before.project.symbols![0], input.location).slice(1));
  expect(admit(snapshot(input), out)).toStrictEqual(out);
  expect(input).toStrictEqual(before);
});
it('retains exact no-op metadata and all outside storage', () => {
  const input = { ...fixture(), selected: ['other'] };
  input.project.symbols![0].shapes[2].pivot = undefined;
  const out = request(input);
  expect(out.removed).toBe(0);
  expect(out.project).toStrictEqual(input.project);
  expect(admit(input, out)).toStrictEqual(out);
});
it('copies replacement paths without editing aliased original keys or arrays', () => {
  const input = fixture(),
    def = input.project.symbols![0];
  def.timeline!.keys[0].shapes = def.shapes;
  def.timeline!.layers![0].keys.splice(1, 0, def.timeline!.keys[0]);
  def.timeline!.layers![0].keys[2].shapes = def.shapes;
  validateProject(input.project);
  const before = structuredClone(input.project),
    out = request(input);
  expect(out.project.symbols![0].shapes).toStrictEqual(before.symbols![0].shapes);
  expect(out.project.symbols![0].timeline!.layers).toStrictEqual(
    before.symbols![0].timeline!.layers,
  );
  expect(artwork(out.project.symbols![0], input.location)[0].nodes).toBeDefined();
  expect(input.project).toStrictEqual(before);
  expect(admit(input, out)).toStrictEqual(out);
});
for (const location of [
  { layerId: '@base', frame: 2 },
  { layerId: 'detail', frame: 4 },
  { layerId: 'missing', frame: 0 },
  { layerId: '@base', frame: 12 },
  { layerId: '@base', frame: -1 },
  { layerId: '@base', frame: NaN },
  { layerId: '@base', frame: Infinity },
  { layerId: '@base', frame: 0.5 },
  { layerId: '', frame: 0 },
  { layerId: '@base', frame: 4, extra: true },
])
  it(`rejects missing/raw frame data ${String(location.layerId)}/${String(location.frame)}/${'extra' in location}`, () => {
    const input = fixture();
    expect(() => snapshot({ ...input, location })).toThrow();
    expect(input.project.symbols![0].timeline!.keys).toHaveLength(2);
  });
for (const flag of ['locked', 'hidden'])
  it(`rejects an original ${flag} track`, () => {
    const input = fixture();
    input.location = { layerId: 'detail', frame: 6 };
    input.project.symbols![0].timeline!.layers![0][flag === 'locked' ? 'locked' : 'visible'] =
      flag === 'locked';
    expect(() => snapshot(input)).toThrow(/visible unlocked/);
  });
for (const key of ['layerId', 'frame'])
  it(`rejects a ${key} getter before reading it`, () => {
    const input = fixture(),
      get = vi.fn(() => (key === 'frame' ? 4 : '@base'));
    Object.defineProperty(input.location!, key, { enumerable: true, get });
    expect(() => snapshot(input)).toThrow();
    expect(get).not.toHaveBeenCalled();
  });
for (const changed of ['location', 'selected', 'ancestry'])
  it(`rechecks original ${changed} after source callbacks`, () => {
    const input = fixture(),
      location = { layerId: '@base', frame: 4 },
      selected = ['line'],
      ancestry = ['outer'];
    let armed = false;
    const scope = capture(() => {
      if (armed) {
        armed = false;
        if (changed === 'location') location.frame = 0;
        if (changed === 'selected') selected[0] = 'other';
        if (changed === 'ancestry') ancestry[0] = 'missing';
      }
      return { project: input.project, revision: 0 };
    });
    armed = true;
    expect(() => scope.resolveFrame('art', location, selected, ancestry)).toThrow(/changed/);
    expect(
      prepare(scope.resolveFrame('art', { layerId: '@base', frame: 4 }, ['line'])).removed,
    ).toBeGreaterThan(0);
  });
for (const change of ['source', 'library', 'revision', 'identity'])
  it(`rejects stale ${change} before preparation`, () => {
    const input = fixture();
    let project = input.project,
      revision = 0;
    const scope = capture(() => ({ project, revision })),
      owner = scope.resolveFrame('art', input.location!, ['line']);
    if (change === 'source')
      project.symbols![0].timeline!.keys[1].shapes.push(
        structuredClone(project.symbols![0].shapes[2]),
      );
    if (change === 'library') project.symbols![1].name = 'edited';
    if (change === 'revision') revision++;
    if (change === 'identity') project = structuredClone(project);
    expect(() => prepare(owner)).toThrow();
  });
it('rechecks complete source after candidate cloning and rejects swallowed reentry', () => {
  const input = fixture(),
    scope = capture(() => ({ project: input.project, revision: 0 })),
    owner = scope.resolveFrame('art', input.location!, ['line']);
  const clone = structuredClone;
  let armed = true;
  vi.stubGlobal('structuredClone', (value: unknown) => {
    const out = clone(value);
    if (armed) {
      armed = false;
      input.project.symbols![1].name = 'late source';
    }
    return out;
  });
  expect(() => prepare(owner)).toThrow();
  vi.unstubAllGlobals();
  const next = fixture(),
    fresh = capture(() => ({ project: next.project, revision: 0 })),
    pick = fresh.resolveFrame('art', next.location!, ['line']);
  expect(() =>
    prepare(pick, {
      validate: () => {
        try {
          prepare(pick);
        } catch {
          /* swallowed reentry must still reject outer preparation */
        }
      },
    }),
  ).toThrow(/reenter/);
  expect(prepare(pick).removed).toBeGreaterThan(0);
});
for (const change of ['other key', 'other track', 'button mapping', 'script', 'selected', 'count'])
  it(`host rejects a forged ${change} frame result`, () => {
    const input = fixture('plain', true),
      out = request(input);
    if (change === 'other key') out.project.symbols![0].shapes[0].x++;
    if (change === 'other track')
      out.project.symbols![0].timeline!.layers![0].keys[0].shapes[0].x++;
    if (change === 'button mapping') out.project.symbols![0].buttonStates!.hit = 9;
    if (change === 'script') out.project.symbols![0].timeline!.frameScripts![0].source = 'changed';
    if (change === 'selected') out.selected = ['other'];
    if (change === 'count') out.removed++;
    expect(() => admit(input, out)).toThrow();
  });
it('rejects retargeted same-ID artwork and supports independent later frame preparation', () => {
  const input = fixture(),
    out = request(input);
  expect(() => admit({ ...input, location: { layerId: '@base', frame: 0 } }, out)).toThrow();
  const later = { ...input, project: out.project, location: { layerId: 'detail', frame: 6 } };
  const next = request(later);
  expect(admit(later, next)).toStrictEqual(next);
  expect(artwork(next.project.symbols![0], input.location)).toStrictEqual(
    artwork(out.project.symbols![0], input.location),
  );
});
it('rejects forged public ownership and disposed original owners', () => {
  const input = fixture(),
    scope = capture(() => ({ project: input.project, revision: 0 })),
    owner = scope.resolveFrame('art', input.location!, ['line']);
  expect(() => prepare({ ...owner })).toThrow(/private/);
  scope.dispose();
  expect(() => prepare(owner)).toThrow(/stale/);
});

it('protects real generated interiors and leaves unrelated remembered recipes exact', () => {
  const input = fixture(),
    project = structuredClone(input.project),
    def = input.project.symbols![0],
    line = structuredClone(def.shapes[0]);
  delete line.groups;
  project.duration = 12;
  project.layers[0].keys = [
    { frame: 0, shapes: [line] },
    { frame: 4, shapes: [{ ...structuredClone(line), x: line.x + 20 }] },
  ];
  createBasicMotionSpan(project, [project.layers[0].id], 0, 4, 'linear');
  def.shapes = project.layers[0].keys[0].shapes;
  def.timeline!.keys = [...project.layers[0].keys.slice(1), { frame: 10, shapes: [] }];
  def.timeline!.motionSpans = project.layers[0].motionSpans;
  validateProject(input.project);
  expect(() => request({ ...input, location: { layerId: '@base', frame: 2 } })).toThrow(
    /Generated/,
  );
  const before = structuredClone(def),
    out = request({ ...input, location: { layerId: 'detail', frame: 6 } }),
    next = out.project.symbols![0];
  expect(next.shapes).toStrictEqual(before.shapes);
  expect(next.timeline!.keys).toStrictEqual(before.timeline!.keys);
  expect(next.timeline!.motionSpans).toStrictEqual(before.timeline!.motionSpans);
  expect(out.removed).toBeGreaterThan(0);
});

it('validates original frame descriptor numbers rather than proxy-coerced values', () => {
  const input = fixture(),
    scope = capture(() => ({ project: input.project, revision: 0 }));
  const location = new Proxy(
    { layerId: '@base', frame: 0.5 },
    { get: (target, key, receiver) => (key === 'frame' ? 4 : Reflect.get(target, key, receiver)) },
  );
  expect(() => scope.resolveFrame('art', location, ['line'])).toThrow(/stored keyframe/);
});
