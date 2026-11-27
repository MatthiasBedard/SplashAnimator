import { afterEach, expect, it, vi } from 'vitest';
import {
  newProject,
  symbolLayers,
  symbolArtworks,
  validateProject,
  MAX_SYMBOL_ARTWORK,
  type Vector,
  type Project,
  type Point,
  type SymbolDefinition,
} from '../packages/document/src';
import {
  createBasicMotionSpan,
  promoteSampledMotionFrame,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import {
  captureRememberedSelectionAuthoringFrame,
  type SampledUnitRequest,
} from '../packages/animation/src/selection-motion-owner';
import {
  captureSymbolRememberedSelectionAuthoringFrame,
  type SymbolSelectionAuthoringSource,
} from '../packages/animation/src/symbol-selection-motion-owner';
import type { GroupAuthoringSource } from '../packages/animation/src/group-motion-owner';
import * as junction from '../packages/animation/src/motion-junction';
import * as motion from '../packages/animation/src/motion-spans';
afterEach(() => vi.restoreAllMocks());
function ink(id: string, x: number, y: number, groups?: string[]): Vector {
  return {
    id,
    kind: 'rectangle',
    x,
    y,
    width: 12,
    height: 12,
    rotation: 0,
    pivot: { x: 3, y: 4 },
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    ...(groups ? { groups } : {}),
  };
}
function rootFixture(mode = 'plain'): GroupAuthoringSource {
  const project = newProject();
  project.duration = 14;
  project.width = 500;
  project.height = 300;
  for (const [i, id] of ['base', 'extra'].entries()) {
    const y = i ? 110 : 10,
      shapes = [
        ink('r', 0, y),
        ink('b', 20, y, ['outer', 'inner']),
        ink('a', 40, y, ['outer', 'inner']),
        ink('c', 60, y, ['outer']),
        ink('other', 100, y),
        ink('d', 130, y, ['second']),
        ink('e', 150, y, ['second']),
      ];
    if (mode === 'absent' || mode === 'defaults') for (const s of shapes) delete s.pivot;
    if (mode === 'affine' || mode === 'reflected' || mode === 'common-reflected')
      for (const s of shapes) {
        s.rotation = 25;
        s.transform = [mode === 'affine' ? 1.3 : -1.3, 0.2, 0.4, 0.8];
      }
    if (['compound', 'aligned', 'asymmetric'].includes(mode))
      for (const s of shapes) {
        s.kind = 'polygon';
        s.closed = true;
        s.fillRule = 'evenodd';
        s.contours = [
          [
            [0, 0],
            [12, 0],
            [12, 12],
            [0, 12],
          ],
          [
            [3, 3],
            [3, 6],
            [6, 3],
          ],
        ].map((r) => r.map(([x, y]) => ({ x, y })));
        if (mode === 'asymmetric' && s.id === 'r')
          s.contours[0] = [
            { x: -8, y: -3 },
            { x: 20, y: -3 },
            { x: 20, y: 13 },
            { x: -8, y: 13 },
          ];
      }
    if (mode === 'asymmetric')
      for (const s of shapes) {
        if (s.id === 'e') {
          s.width = 57;
          s.height = 27;
        }
        if (s.id === 'c') s.height = 41;
        if (s.id === 'r') {
          s.width = 28;
          s.height = 16;
        } else
          s.contours![0] = [
            { x: 0, y: 0 },
            { x: s.width, y: 0 },
            { x: s.width, y: s.height },
            { x: 0, y: s.height },
          ];
      }
    if (['loop', 'once', 'single', 'movie', 'nested-button'].includes(mode)) {
      project.symbols ??= [
        {
          id: 'child',
          name: 'Child',
          width: 12,
          height: 12,
          shapes: [ink('kid', 0, 0)],
          timeline: {
            duration: 3,
            keys: [{ frame: 2, shapes: [{ ...ink('kid', 0, 0), fill: '#0000ff' }] }],
          },
        },
      ];
      shapes[3] = {
        ...shapes[3],
        kind: 'symbol',
        symbolId: 'child',
        symbolPlayback: { mode: mode as 'loop' | 'once' | 'single' | 'movie', firstFrame: 1 },
      };
      if (mode === 'nested-button') {
        const button = {
            ...project.symbols![0],
            id: 'button',
            buttonStates: { up: 0, over: 1, down: 2, hit: 0 },
          },
          container = {
            id: 'container',
            name: 'Container',
            width: 12,
            height: 12,
            shapes: [
              {
                ...ink('button-instance', 0, 0),
                kind: 'symbol' as const,
                symbolId: 'button',
                symbolPlayback: { mode: 'single' as const, firstFrame: 0 },
              },
            ],
          };
        project.symbols = [button, container];
        shapes[3] = {
          ...shapes[3],
          symbolId: 'container',
          symbolPlayback: { mode: 'movie', firstFrame: 0 },
        };
      }
    }
    const end = shapes.map((s) => ({ ...structuredClone(s), x: s.x + (i ? 100 : 80) }));
    if (mode === 'aligned')
      for (const s of end)
        s.contours = [...s.contours!].reverse().map((r) => [r[1], r[0], ...r.slice(2).reverse()]);
    if (mode.startsWith('common'))
      for (const s of [...shapes, ...end]) {
        const [a, b, c, d] = basis(s),
          det = a * d - b * c,
          x = 17 - s.x,
          y = -23 - s.y;
        s.pivot = { x: (d * x - c * y) / det, y: (a * y - b * x) / det };
      }
    const layer = {
      id,
      name: id,
      visible: true,
      locked: false,
      drawingMode: 'object' as const,
      keys: [
        { frame: 0, shapes },
        { frame: i ? 10 : 8, shapes: end },
        { frame: 12, shapes: [] },
      ],
    };
    if (i === 0) project.layers = [layer];
    else project.layers.push(layer);
    const rotation =
      mode === 'aligned'
        ? undefined
        : {
            direction: (mode === 'clockwise' || mode === 'counterclockwise' ? mode : 'shortest') as
              'clockwise' | 'counterclockwise' | 'shortest',
            turns: mode === 'clockwise' || mode === 'counterclockwise' ? 1 : 0,
            rigidGroups: true,
            axisGroupScale: true,
            axisGroupShear: true,
            ...(mode === 'orbit' ? { savedGroupPivots: true } : {}),
          };
    createBasicMotionSpan(
      project,
      [id],
      0,
      i ? 10 : 8,
      'linear',
      {
        affine: true,
        ...(mode === 'aligned' ? { nodes: true } : {}),
        ...(mode.startsWith('common') ? { pivots: true } : {}),
        ...(mode === 'defaults' ? { pivots: true, defaultPivots: true } : {}),
      },
      undefined,
      rotation,
      mode === 'aligned' ? { order: [1, 0], start: [1, 1], reverse: [true, true] } : undefined,
    );
  }
  validateProject(project);
  return { project, revision: 2, frame: 4 };
}
function basis(s: Vector) {
  const r = (s.rotation * Math.PI) / 180,
    c = Math.cos(r),
    n = Math.sin(r),
    [a, b, u, d] = s.transform ?? [1, 0, 0, 1];
  return [c * a - n * b, n * a + c * b, c * u - n * d, n * u + c * d];
}
function world(s: Vector, p: Point) {
  const [a, b, c, d] = basis(s);
  return { x: s.x + a * p.x + c * p.y, y: s.y + b * p.x + d * p.y };
}
function rotate(p: Point, center: Point, degrees: number) {
  const r = (degrees * Math.PI) / 180,
    c = Math.cos(r),
    n = Math.sin(r),
    x = p.x - center.x,
    y = p.y - center.y;
  return { x: center.x + c * x - n * y, y: center.y + n * x + c * y };
}

function fixture(mode = 'plain'): SymbolSelectionAuthoringSource {
  const { project, revision, frame } = rootFixture(mode),
    [base, ...extra] = project.layers;
  base.id = '@base';
  delete extra[0].drawingMode;
  const definition: SymbolDefinition = {
    id: 'local',
    name: 'Local',
    width: 500,
    height: 300,
    multiFramePivot: { x: -17, y: 91 },
    buttonStates: { up: 0, over: 4, down: 8, hit: 12 },
    shapes: base.keys[0].shapes,
    timeline: {
      duration: 14,
      keys: base.keys.slice(1),
      motionSpans: base.motionSpans,
      layers: extra,
    },
  };
  return {
    definition,
    symbols: [definition, ...(project.symbols ?? [])],
    assets: project.assets,
    revision,
    frame,
  };
}
const pick = (layerId: string, shapeId: string) => ({ layerId, shapeId });
const mixed = [pick('extra', 'c'), pick('@base', 'e'), pick('@base', 'a'), pick('@base', 'r')];
function adapter(state: SymbolSelectionAuthoringSource): Project {
  const p = newProject();
  p.duration = 14;
  p.layers = structuredClone(symbolLayers(state.definition)).map((l) => ({
    ...l,
    drawingMode: l.drawingMode ?? 'object',
  }));
  p.symbols = structuredClone([
    ...state.symbols.filter((s) => s.id !== state.definition.id),
    state.definition,
  ]);
  p.assets = structuredClone(state.assets);
  return p;
}
function comparable(d: SymbolDefinition) {
  const out = structuredClone(d);
  for (const l of symbolLayers(out)) for (const span of l.motionSpans ?? []) span.id = 'owned-span';
  return out;
}
function headers(p: Project) {
  return p.layers.map((l) =>
    l.motionSpans!.map((span) => ({
      ...Object.fromEntries(Object.entries(span).filter(([k]) => k !== 'baseline')),
      id: span.start === 4 ? 'owned-new-right' : span.id,
    })),
  );
}
function saved(candidate: Project, state: SymbolSelectionAuthoringSource): SymbolDefinition {
  const [base, ...extra] = candidate.layers,
    original = state.definition;
  return {
    ...original,
    shapes: base.keys[0].shapes,
    timeline: {
      ...original.timeline!,
      keys: base.keys.slice(1),
      motionSpans: base.motionSpans,
      ...(original.timeline!.layers !== undefined
        ? {
            layers: extra.map((l, i) => {
              const result = { ...l };
              if (original.timeline!.layers![i].drawingMode === undefined) {
                if (Object.hasOwn(original.timeline!.layers![i], 'drawingMode'))
                  result.drawingMode = undefined;
                else delete result.drawingMode;
              }
              return result;
            }),
          }
        : {}),
    },
  };
}
for (const mode of [
  'plain',
  'absent',
  'defaults',
  'affine',
  'reflected',
  'compound',
  'aligned',
  'asymmetric',
  'common',
  'common-reflected',
  'loop',
  'once',
  'single',
  'movie',
  'nested-button',
  'orbit',
  'clockwise',
  'counterclockwise',
])
  for (const degrees of [37, -90])
    it('prepares actual-library isolated union rotation ' + mode + ' ' + degrees, () => {
      const state = fixture(mode),
        before = structuredClone(state),
        cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
        owner = cap.resolveRotation(mixed),
        scene = cap.scene;
      expect(owner.definitionId).toBe('local');
      expect(owner.units.map((u) => [u.layerId, u.kind, u.shapeId, u.shapeIds])).toEqual([
        ['@base', 'root', 'r', ['r']],
        ['@base', 'group', 'b', ['b', 'a', 'c']],
        ['@base', 'group', 'd', ['d', 'e']],
        ['extra', 'group', 'b', ['b', 'a', 'c']],
      ]);
      const originals = owner.tracks.flatMap((t) =>
        scene
          .find((l) => l.layerId === t.layerId)!
          .key.shapes.filter((s) => t.shapeIds.includes(s.id)),
      );
      const corners = originals.flatMap((s) =>
        [
          { x: 0, y: 0 },
          { x: s.width, y: 0 },
          { x: 0, y: s.height },
          { x: s.width, y: s.height },
        ].map((p) => world(s, p)),
      );
      const pivot = mode.startsWith('common')
        ? { x: 17, y: -23 }
        : {
            x: (Math.min(...corners.map((p) => p.x)) + Math.max(...corners.map((p) => p.x))) / 2,
            y: (Math.min(...corners.map((p) => p.y)) + Math.max(...corners.map((p) => p.y))) / 2,
          };
      expect(owner.pivot.x).toBeCloseTo(pivot.x, 8);
      expect(owner.pivot.y).toBeCloseTo(pivot.y, 8);
      if (mode === 'plain') expect(owner.pivot).toEqual({ x: 121, y: 66 });
      if (mode === 'asymmetric') expect(owner.pivot).toEqual({ x: 143.5, y: 80.5 });
      const p = adapter(state),
        expected = captureRememberedSelectionAuthoringFrame(() => ({
          project: p,
          frame: 4,
          revision: 2,
        })).prepareRotation(mixed, degrees),
        out = cap.prepareRotation(mixed, degrees);
      expect(comparable(out)).toEqual(comparable(saved(expected, state)));
      expect(out.buttonStates).toEqual(state.definition.buttonStates);
      expect(out.multiFramePivot).toEqual(state.definition.multiFramePivot);
      expect([out.width, out.height, out.name, out.timeline!.duration]).toEqual([
        500,
        300,
        'Local',
        14,
      ]);
      const promoted = adapter(state);
      for (const t of owner.tracks)
        promoteSampledMotionFrame(promoted, [t.layerId], t.start, t.end, 4);
      const actual = adapter({ ...state, definition: out });
      expect(headers(actual)).toEqual(headers(promoted));
      for (const track of owner.tracks) {
        const old = symbolLayers(state.definition).find((l) => l.id === track.layerId)!,
          next = symbolLayers(out).find((l) => l.id === track.layerId)!,
          sample = scene.find((l) => l.layerId === track.layerId)!.key.shapes;
        expect(next.keys.filter((k) => [0, track.end, 12].includes(k.frame))).toEqual(
          old.keys.filter((k) => [0, track.end, 12].includes(k.frame)),
        );
        for (const s of sample) {
          const got = next.keys.find((k) => k.frame === 4)!.shapes.find((v) => v.id === s.id)!;
          if (!track.shapeIds.includes(s.id)) {
            expect(got).toEqual(s);
            continue;
          }
          expect({ ...got, x: s.x, y: s.y, rotation: s.rotation }).toEqual(s);
          for (const local of [
            { x: 0, y: 0 },
            { x: 7, y: 11 },
          ]) {
            const wanted = rotate(world(s, local), pivot, degrees),
              point = world(got, local);
            expect(point.x).toBeCloseTo(wanted.x, 8);
            expect(point.y).toBeCloseTo(wanted.y, 8);
          }
        }
      }
      for (const l of actual.layers)
        for (const span of [...l.motionSpans!])
          refreshBasicMotionSpan(actual, [l.id], span.start, span.end);
      validateProject(actual);
      expect(state).toEqual(before);
    });
for (const requests of [
  [pick('@base', 'r'), pick('extra', 'r')],
  [pick('@base', 'a'), pick('extra', 'a')],
  [pick('@base', 'a'), pick('@base', 'e')],
  [pick('@base', 'r')],
])
  it('owns canonical complete root/group unions ' + JSON.stringify(requests), () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      forward = cap.resolveRotation(requests);
    expect(cap.resolveRotation([...requests].reverse())).toEqual(forward);
    const spy = vi.spyOn(junction, 'rotateRememberedEndpoint');
    const out = cap.prepareRotation(requests, 37);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][4]).toEqual(forward.pivot);
    expect(symbolLayers(out).filter((l) => l.motionSpans?.length === 2)).toHaveLength(
      forward.tracks.length,
    );
  });
it('keeps public owner/pivot/scene/choice/output hints detached and legacy translation exact', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    owner = cap.resolveRotation(mixed),
    canonical = structuredClone(owner),
    expected = cap.prepareRotation(mixed, 37);
  owner.pivot.x = 999;
  owner.definitionId = 'forged';
  owner.units[0].shapeIds = ['other'];
  owner.tracks[0].shapeIds = ['other'];
  cap.scene[0].key.shapes.splice(0);
  cap.choices.splice(0);
  const out = cap.prepareRotation(
    mixed.map((r) => ({ ...r, pivot: { x: 99, y: 99 }, shapeIds: ['other'] })),
    37,
  );
  expect(comparable(out)).toEqual(comparable(expected));
  out.timeline!.keys.find((k) => k.frame === 4)!.shapes[0].x++;
  out.name = 'mutated';
  expect(cap.resolveRotation(mixed)).toEqual(canonical);
  expect(comparable(cap.prepareRotation(mixed, 37))).toEqual(comparable(expected));
  expect(Object.hasOwn(cap.resolveSelection(mixed), 'pivot')).toBe(false);
  const p = adapter(state),
    translation = captureRememberedSelectionAuthoringFrame(() => ({
      project: p,
      frame: 4,
      revision: 2,
    })).prepareTranslation(mixed, { x: 5, y: 4 });
  expect(comparable(cap.prepareTranslation(mixed, { x: 5, y: 4 }))).toEqual(
    comparable(saved(translation, state)),
  );
  expect(state).toEqual(before);
});
for (const angle of [
  0,
  360,
  -720,
  NaN,
  Infinity,
  -Infinity,
  Number.MIN_VALUE,
  Number.MAX_VALUE,
  '37',
  new Number(37),
  undefined,
  null,
])
  it('rejects raw/noop/unrepresentable degrees ' + String(angle), () => {
    const state = fixture('affine'),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareRotation(mixed, angle as number)).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareRotation(mixed, 37)).toBeDefined();
  });
it('rejects a finite angle absorbed by original poses', () => {
  const state = fixture('affine'),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
  expect(() => cap.prepareRotation(mixed, 1e-300)).toThrow(/represented/);
  expect(cap.prepareRotation(mixed, 37)).toBeDefined();
});
for (const requests of [
  [],
  [pick('missing', 'r')],
  [pick('@base', 'missing')],
  [pick('@base', 'r'), pick('@base', 'r')],
  [pick('@base', 'a'), pick('@base', 'c')],
  [{ layerId: 1, shapeId: 'r' }],
  [{ layerId: '@base' }],
  { 0: pick('@base', 'r'), length: 1 },
])
  it('rejects malformed/overlapping picks ' + JSON.stringify(requests), () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareRotation(requests as SampledUnitRequest[], 37)).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareRotation([pick('@base', 'r')], 37)).toBeDefined();
  });
for (const field of [
  'definition-reference',
  'symbols-reference',
  'assets-reference',
  'revision',
  'frame',
  'membership',
  'recipe',
  'interior',
  'assets',
  'numeric',
])
  it('invalidates original isolated ownership after ' + field, () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    cap.resolveRotation(mixed);
    if (field === 'definition-reference') state.definition = structuredClone(state.definition);
    if (field === 'symbols-reference') state.symbols = [...state.symbols];
    if (field === 'assets-reference') state.assets = [...state.assets];
    if (field === 'revision') state.revision++;
    if (field === 'frame') state.frame++;
    if (field === 'membership')
      state.definition.timeline!.layers![0].keys[0].shapes[1].groups = ['changed'];
    if (field === 'recipe') state.definition.timeline!.motionSpans![0].id = 'changed';
    if (field === 'interior') state.definition.timeline!.keys[0].shapes[0].x++;
    if (field === 'assets') state.assets.push({ id: 'new', path: 'assets/new.bin' });
    if (field === 'numeric') state.definition.shapes[0].x = NaN;
    const changed = structuredClone(state);
    expect(() => cap.prepareRotation(mixed, 37)).toThrow();
    expect(() => cap.resolveRotation(mixed)).toThrow(/invalidated/);
    expect(state).toEqual(changed);
  });
for (const field of ['hidden', 'locked', 'merge', 'authored', 'near-start', 'held'])
  it('rejects nonauthorable original isolated scope ' + field, () => {
    const state = fixture();
    if (field === 'hidden') state.definition.timeline!.layers![0].visible = false;
    if (field === 'locked') state.definition.timeline!.layers![0].locked = true;
    if (field === 'merge') state.definition.timeline!.layers![0].drawingMode = 'merge';
    if (field === 'authored') state.frame = 8;
    if (field === 'near-start') state.frame = 1;
    if (field === 'held') state.frame = 12;
    const before = structuredClone(state);
    expect(() =>
      captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareRotation(mixed, 37),
    ).toThrow();
    expect(state).toEqual(before);
  });
it('snapshots raw request identity and enclosing callback exactly once', () => {
  const state = fixture(),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    reads = { layer: 0, shape: 0, validate: 0 };
  cap.prepareRotation(
    [
      {
        get layerId() {
          reads.layer++;
          return '@base';
        },
        get shapeId() {
          reads.shape++;
          return 'a';
        },
      },
    ],
    37,
    {
      get validate() {
        reads.validate++;
        return () => {};
      },
    },
  );
  expect(reads).toEqual({ layer: 1, shape: 1, validate: 1 });
});
for (const field of ['request', 'validate', 'length'])
  it('rechecks source after input getters ' + field, () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      requests = [pick('@base', 'r')];
    let options = {};
    if (field === 'request')
      Object.defineProperty(requests[0], 'shapeId', {
        get() {
          state.revision++;
          return 'r';
        },
      });
    if (field === 'validate')
      options = {
        get validate() {
          state.revision++;
          return () => {};
        },
      };
    if (field === 'length')
      Object.defineProperty(requests, 0, {
        get() {
          requests.push(pick('@base', 'other'));
          return pick('@base', 'r');
        },
      });
    expect(() => cap.prepareRotation(requests, 37, options)).toThrow();
  });
for (const method of ['resolveRotation', 'prepareRotation', 'scene', 'dispose'])
  it('rejects swallowed capture reentry ' + method, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() =>
      cap.prepareRotation(mixed, 37, {
        validate() {
          try {
            if (method === 'resolveRotation') cap.resolveRotation(mixed);
            if (method === 'prepareRotation') cap.prepareRotation(mixed, 17);
            if (method === 'scene') void cap.scene;
            if (method === 'dispose') cap.dispose();
          } catch {
            /* Deliberate hostile caller. */
          }
        },
      }),
    ).toThrow();
    expect(state).toEqual(before);
    expect(() => cap.resolveRotation(mixed)).toThrow();
  });
for (const value of [null, 2, {}, Promise.resolve()])
  it('rejects invalid enclosing callback ' + String(value), () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareRotation(mixed, 37, { validate: value as never })).toThrow();
    expect(cap.prepareRotation(mixed, 37)).toBeDefined();
  });
it('rejects async and failed enclosing ownership without losing a valid retry', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
  expect(() =>
    cap.prepareRotation(mixed, 37, {
      validate: async () => {
        throw Error('async');
      },
    }),
  ).toThrow(/synchronous/);
  expect(() =>
    cap.prepareRotation(mixed, 37, {
      validate() {
        throw Error('enclosing changed');
      },
    }),
  ).toThrow(/enclosing changed/);
  expect(state).toEqual(before);
  expect(cap.prepareRotation(mixed, 37)).toBeDefined();
});
for (const field of ['source', 'options', 'headers'])
  it('checks completed detached all-track math before conversion ' + field, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      rotate = junction.rotateRememberedEndpoint;
    let complete = false;
    vi.spyOn(junction, 'rotateRememberedEndpoint').mockImplementation((...args) => {
      rotate(...args);
      complete = args[0].layers.every((l) => l.motionSpans?.length === 2);
      expect(args[0].layers[0].keys.find((k) => k.frame === 4)!.shapes[0].rotation).toBe(37);
      if (field === 'source') state.revision++;
      if (field === 'options') args[0].layers[1].motionSpans![0].options!.affine = false;
      if (field === 'headers') args[0].layers[1].motionSpans![0].rotation!.direction = 'clockwise';
    });
    expect(() => cap.prepareRotation(mixed, 37)).toThrow();
    expect(complete).toBe(true);
    expect(state.definition).toEqual(before.definition);
  });
for (const field of ['source', 'library', 'assets', 'enclosing', 'output', 'mapping', 'options'])
  it(
    'admits original resources and full replacement after converted definition cloning ' + field,
    () => {
      const state = fixture(),
        before = structuredClone(state),
        cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
        clone = structuredClone;
      let complete = false,
        valid = true;
      const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
        const out = clone(value, options),
          d = out as SymbolDefinition;
        if (!complete && d?.id === 'local' && d.timeline?.motionSpans?.length === 2) {
          expect(d.timeline.layers![0].motionSpans).toHaveLength(2);
          expect(d.timeline.keys.find((k) => k.frame === 4)!.shapes[0].rotation).toBe(37);
          complete = true;
          if (field === 'source') state.revision++;
          if (field === 'library')
            state.symbols.push({ id: 'late', name: 'Late', width: 1, height: 1, shapes: [] });
          if (field === 'assets') state.assets.push({ id: 'late', path: 'assets/late.bin' });
          if (field === 'enclosing') valid = false;
          if (field === 'output') d.name = 'forged';
          if (field === 'mapping') d.buttonStates!.up = 1;
          if (field === 'options') d.timeline.motionSpans[0].options!.affine = false;
        }
        return out;
      });
      expect(() =>
        cap.prepareRotation(mixed, 37, {
          validate() {
            if (!valid) throw Error('enclosing changed');
          },
        }),
      ).toThrow();
      expect(complete).toBe(true);
      expect(state.definition).toEqual(before.definition);
      spy.mockRestore();
      if (['enclosing', 'output', 'mapping', 'options'].includes(field))
        expect(cap.prepareRotation(mixed, 37)).toBeDefined();
    },
  );
it('rejects output mutation from the final enclosing callback after clone validation', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    clone = structuredClone;
  let output: SymbolDefinition | undefined,
    admissions = 0;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const out = clone(value, options),
      d = out as SymbolDefinition;
    if (d?.id === 'local' && d.timeline?.motionSpans?.length === 2) output = d;
    return out;
  });
  expect(() =>
    cap.prepareRotation(mixed, 37, {
      validate() {
        if (output && ++admissions === 2) output.name = 'forged';
      },
    }),
  ).toThrow(/changed during/);
  expect(admissions).toBe(2);
  expect(state).toEqual(before);
});
for (const value of [undefined, false])
  it('preserves original group-shear admission without enabling ' + value, () => {
    const state = fixture();
    state.definition.timeline!.layers![0].motionSpans![0].rotation!.axisGroupShear = value;
    const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareRotation(mixed, 37)).toThrow(/already admit/);
    expect(cap.prepareRotation([pick('@base', 'r')], 37)).toBeDefined();
  });
it('rejects later-track overflow after successful first-track preparation without source writes', () => {
  const state = fixture(),
    p = adapter(state);
  for (const k of p.layers[1].keys.filter((k) => k.frame === 0 || k.frame === 10))
    k.shapes.forEach((s) => (s.x += 9e6));
  refreshBasicMotionSpan(p, ['extra'], 0, 10);
  state.definition = saved(p, state);
  state.symbols[0] = state.definition;
  const before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    rotate = junction.rotateRememberedEndpoint,
    refresh = vi.spyOn(motion, 'refreshBasicMotionSpan');
  let first = false;
  vi.spyOn(junction, 'rotateRememberedEndpoint').mockImplementation((...args) => {
    refresh.mockClear();
    try {
      rotate(...args);
    } finally {
      first = refresh.mock.calls.filter((call) => call[1][0] === '@base').length === 2;
    }
  });
  expect(() => cap.prepareRotation(mixed, 1)).toThrow(/geometry limits/);
  expect(first).toBe(true);
  expect(state).toEqual(before);
  vi.restoreAllMocks();
  expect(cap.prepareRotation([pick('@base', 'r')], 37)).toBeDefined();
});
it('refreshes and JSON reopens complete rotated definitions for later isolated editing', () => {
  const state = fixture('reflected'),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    definition = JSON.parse(JSON.stringify(cap.prepareRotation(mixed, 37))) as SymbolDefinition,
    p = adapter({ ...state, definition }),
    before = structuredClone(p);
  for (const l of p.layers)
    for (const span of [...l.motionSpans!]) refreshBasicMotionSpan(p, [l.id], span.start, span.end);
  expect(p).toEqual(before);
  const reopened = {
    ...state,
    definition,
    symbols: [definition],
    frame: 2,
    revision: 0,
  };
  const later = captureSymbolRememberedSelectionAuthoringFrame(() => reopened);
  const out = later.prepareRotation([pick('@base', 'r'), pick('@base', 'a')], -17);
  expect(out.timeline!.motionSpans).toHaveLength(3);
  expect(out.buttonStates).toEqual(state.definition.buttonStates);
});
for (const value of ['absent', 'undefined', 'empty'])
  it('preserves exact optional additional-track representation ' + value, () => {
    const state = fixture();
    if (value === 'absent') delete state.definition.timeline!.layers;
    else state.definition.timeline!.layers = value === 'empty' ? [] : undefined;
    const before = structuredClone(state),
      out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareRotation(
        [pick('@base', 'r')],
        37,
      );
    expect(Object.hasOwn(out.timeline!, 'layers')).toBe(
      Object.hasOwn(state.definition.timeline!, 'layers'),
    );
    expect(out.timeline!.layers).toStrictEqual(state.definition.timeline!.layers);
    expect(state).toEqual(before);
  });
for (const value of [undefined, 'object'] as const)
  it('preserves additional drawingMode ' + value, () => {
    const state = fixture();
    state.definition.timeline!.layers![0].drawingMode = value;
    const out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareRotation(
      [pick('@base', 'r')],
      37,
    );
    expect(Object.hasOwn(out.timeline!.layers![0], 'drawingMode')).toBe(true);
    expect(out.timeline!.layers![0].drawingMode).toBe(value);
  });
it('rejects invalid merge-mode symbol layers without publishing rotation', () => {
  const state = fixture();
  state.definition.timeline!.layers![0].drawingMode = 'merge';
  const before = structuredClone(state);
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(/symbol layer/);
  expect(state).toEqual(before);
});
for (const size of [0, 0.25, 200000])
  it('preserves actual symbol bounds without applying root-stage bounds ' + size, () => {
    const state = fixture();
    state.definition.width = size;
    state.definition.height = size;
    const out = captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareRotation(
      mixed,
      37,
    );
    expect([out.width, out.height]).toEqual([size, size]);
  });
it('uses actual bitmap metadata and complete original library instead of inventing resources', () => {
  const state = fixture();
  state.assets = [
    {
      id: 'bitmap',
      path: 'assets/bitmaps/actual.json',
      bitmap: { name: 'Actual', width: 12, height: 12 },
    },
  ];
  const p = adapter(state);
  for (const l of p.layers) {
    for (const k of l.keys.filter((k) => k.frame === 0 || k.frame === (l.id === '@base' ? 8 : 10)))
      k.shapes[0].bitmap = { assetId: 'bitmap', x: 0, y: 0, width: 12, height: 12, repeat: true };
    refreshBasicMotionSpan(p, [l.id], 0, l.id === '@base' ? 8 : 10);
  }
  state.definition = saved(p, state);
  state.symbols[0] = state.definition;
  const before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareRotation(mixed, 37);
  expect(out.timeline!.keys.find((k) => k.frame === 4)!.shapes[0].bitmap).toEqual(
    cap.scene[0].key.shapes[0].bitmap,
  );
  expect(state).toEqual(before);
  state.assets = [];
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow();
});
it('validates the original library as well as its detached local-definition overlay', () => {
  const state = fixture();
  const original = structuredClone(state.definition);
  original.shapes[0].bitmap = { assetId: 'missing', x: 0, y: 0, width: 1, height: 1 };
  state.symbols[0] = original;
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow();
});
it('owns the actual local draft overlay independently of the saved library definition', () => {
  const state = fixture(),
    original = structuredClone(state.symbols),
    p = adapter(state);
  for (const key of p.layers[0].keys.filter((k) => k.frame === 0 || k.frame === 8))
    key.shapes.forEach((shape) => (shape.x += 17));
  refreshBasicMotionSpan(p, ['@base'], 0, 8);
  state.definition = saved(p, state);
  state.definition.name = 'Local draft';
  state.definition.width = 503.5;
  const before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
  expect(cap.scene[0].key.shapes[0].x).toBe(57);
  const out = cap.prepareRotation(mixed, 37);
  expect([out.name, out.width]).toEqual(['Local draft', 503.5]);
  expect(state.symbols).toEqual(original);
  expect(state).toEqual(before);
});
it('rechecks actual library/assets ownership after final replacement metadata reads', () => {
  let state = fixture(),
    reads = 0;
  const probe = captureSymbolRememberedSelectionAuthoringFrame(() => {
    reads++;
    return state;
  });
  const start = reads;
  probe.prepareRotation([pick('@base', 'r')], 37);
  const cost = reads - start;
  probe.dispose();
  state = fixture();
  let count = 0,
    flip = Infinity;
  const cap = captureSymbolRememberedSelectionAuthoringFrame(() => {
    if (++count === flip) state.assets.push({ id: 'final', path: 'assets/final.bin' });
    return state;
  });
  flip = count + cost;
  expect(() => cap.prepareRotation([pick('@base', 'r')], 37)).toThrow(/changed/);
  expect(state.assets.at(-1)!.id).toBe('final');
});
it('admits exact aggregate capacity, rejects original and local overlay overflow', () => {
  const state = fixture(),
    count = symbolArtworks(state.definition).reduce((n, a) => n + a.length, 0);
  state.symbols.push({
    id: 'spare',
    name: 'Spare',
    width: 1,
    height: 1,
    shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - count }, (_, i) => ({
      ...ink('art-' + i, 0, 0),
      width: 1,
      height: 1,
    })),
  });
  const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    out = cap.prepareRotation([pick('@base', 'r')], 37);
  expect(symbolArtworks(out).reduce((n, a) => n + a.length, 0)).toBe(count);
  cap.dispose();
  const original = state.definition;
  state.definition = structuredClone(original);
  state.definition.shapes.push(ink('draft-overflow', 0, 0));
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(
    /symbol artwork budget/,
  );
  state.definition = original;
  state.symbols[1].shapes.push(ink('overflow', 0, 0));
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(
    /symbol artwork budget/,
  );
}, 60000);
it('rejects replacement aggregate overflow after completed converted output cloning with a source-valid retry', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    clone = structuredClone;
  let complete = false;
  const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const out = clone(value, options),
      d = out as SymbolDefinition;
    if (!complete && d?.id === 'local' && d.timeline?.motionSpans?.length === 2) {
      complete = true;
      d.shapes = Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({
        ...ink('overflow-' + i, 0, 0),
        width: 1,
        height: 1,
      }));
    }
    return out;
  });
  expect(() => cap.prepareRotation(mixed, 37)).toThrow(/symbol artwork budget/);
  expect(complete).toBe(true);
  expect(state).toEqual(before);
  spy.mockRestore();
  expect(cap.prepareRotation(mixed, 37)).toBeDefined();
}, 60000);
