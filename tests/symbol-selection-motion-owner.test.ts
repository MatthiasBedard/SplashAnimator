import { afterEach, expect, it, vi } from 'vitest';
import {
  MAX_SYMBOL_ARTWORK,
  newProject,
  symbolArtworks,
  symbolLayers,
  validateProject,
  type Project,
  type Vector,
  type SymbolDefinition,
} from '../packages/document/src';
import {
  createBasicMotionSpan,
  editSymbolBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import {
  captureSymbolRememberedSelectionAuthoringFrame,
  type SymbolSelectionAuthoringSource,
} from '../packages/animation/src/symbol-selection-motion-owner';
import { captureSymbolRememberedAuthoringFrame } from '../packages/animation/src/symbol-motion-owner';
import type { SampledUnitRequest } from '../packages/animation/src/selection-motion-owner';
import * as junction from '../packages/animation/src/motion-junction';
import { matrix, worldPoint } from '../packages/geometry/src';

afterEach(() => vi.restoreAllMocks());
function ink(id: string, x: number, groups?: string[]): Vector {
  return {
    id,
    kind: 'rectangle',
    x,
    y: 10,
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
function fixture(mode = 'plain'): SymbolSelectionAuthoringSource {
  const p = newProject();
  p.duration = 14;
  p.width = 400;
  p.height = 240;
  const base = p.layers[0];
  base.id = '@base';
  base.drawingMode = 'object';
  const shapes = [
    ink('r', 0),
    ink('b', 20, ['outer', 'inner']),
    ink('a', 40, ['outer', 'inner']),
    ink('c', 60, ['outer']),
    ink('other', 100),
    ink('d', 130, ['second']),
    ink('e', 150, ['second']),
  ];
  if (mode === 'affine' || mode === 'reflected')
    for (const s of shapes) {
      s.rotation = 25;
      s.transform = [mode === 'reflected' ? -1.3 : 1.3, 0.2, 0.4, 0.8];
    }
  if (mode === 'compound')
    for (const s of shapes.filter((s) => ['r', 'a'].includes(s.id))) {
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
          [3, 9],
          [9, 9],
          [9, 3],
        ],
      ].map((r) => r.map(([x, y]) => ({ x, y, out: { x: x + 1, y } })));
    }
  if (['loop', 'once', 'single', 'movie'].includes(mode)) {
    p.symbols = [
      {
        id: 'child',
        name: 'Child',
        width: 12,
        height: 12,
        shapes: [ink('kid', 0)],
        timeline: {
          duration: 3,
          keys: [{ frame: 2, shapes: [{ ...ink('kid', 0), fill: '#00ff00' }] }],
        },
      },
    ];
    shapes[3] = {
      ...shapes[3],
      kind: 'symbol',
      symbolId: 'child',
      symbolPlayback: { mode: mode as 'loop' | 'once' | 'single' | 'movie', firstFrame: 1 },
    };
  }
  base.keys = [
    { frame: 0, shapes },
    { frame: 8, shapes: shapes.map((s) => ({ ...structuredClone(s), x: s.x + 80 })) },
    { frame: 12, shapes: [] },
  ];
  createBasicMotionSpan(p, ['@base'], 0, 8, 'linear', { affine: true }, undefined, {
    direction: 'shortest',
    turns: 0,
    rigidGroups: true,
    axisGroupScale: true,
    axisGroupShear: true,
  });
  const extra = {
    ...structuredClone(base),
    id: 'extra',
    name: 'Extra',
    keys: [
      { frame: 0, shapes: structuredClone(shapes) },
      { frame: 10, shapes: shapes.map((s) => ({ ...structuredClone(s), x: s.x + 100 })) },
      { frame: 12, shapes: [] },
    ],
    motionSpans: undefined,
  };
  p.layers.push(extra);
  createBasicMotionSpan(p, ['extra'], 0, 10, 'linear', { affine: true }, undefined, {
    direction: 'shortest',
    turns: 0,
    rigidGroups: true,
    axisGroupScale: true,
    axisGroupShear: true,
  });
  delete extra.drawingMode;
  const definition: SymbolDefinition = {
    id: 'local',
    name: 'Local',
    width: 400,
    height: 240,
    multiFramePivot: { x: 7, y: 9 },
    buttonStates: { up: 0, over: 4, down: 8, hit: 12 },
    shapes: base.keys[0].shapes,
    timeline: {
      duration: 14,
      keys: base.keys.slice(1),
      motionSpans: base.motionSpans,
      layers: [extra],
    },
  };
  return {
    definition,
    symbols: [definition, ...(p.symbols ?? [])],
    assets: p.assets,
    revision: 2,
    frame: 4,
  };
}
const pick = (layerId: string, shapeId: string) => ({ layerId, shapeId });
const mixed = [pick('extra', 'c'), pick('@base', 'e'), pick('@base', 'a'), pick('@base', 'r')];
function comparable(d: SymbolDefinition) {
  const result = structuredClone(d);
  for (const layer of symbolLayers(result))
    for (const span of layer.motionSpans ?? []) span.id = 'owned-span';
  return result;
}

for (const mode of ['plain', 'affine', 'reflected', 'compound', 'loop', 'once', 'single', 'movie'])
  it(
    'prepares detached mixed units with complete original settings and independent world points: ' +
      mode,
    () => {
      const state = fixture(mode),
        before = structuredClone(state),
        cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
      const owner = cap.resolveSelection(mixed),
        pose = cap.scene;
      expect(owner.definitionId).toBe('local');
      expect(owner.units.map((u) => [u.layerId, u.kind, u.shapeId, u.shapeIds])).toEqual([
        ['@base', 'root', 'r', ['r']],
        ['@base', 'group', 'b', ['b', 'a', 'c']],
        ['@base', 'group', 'd', ['d', 'e']],
        ['extra', 'group', 'b', ['b', 'a', 'c']],
      ]);
      const candidate = cap.prepareTranslation(mixed, { x: 10, y: -6 });
      let expected = structuredClone(state.definition);
      for (const track of owner.tracks)
        expected = editSymbolBasicMotionSpan(
          expected,
          [track.layerId],
          track.start,
          track.end,
          'promote',
          'linear',
          state.symbols,
          undefined,
          false,
          undefined,
          undefined,
          undefined,
          false,
          undefined,
          undefined,
          undefined,
          undefined,
          4,
        );
      expected = junction.translateSymbolRememberedEndpoint(
        expected,
        state.symbols,
        4,
        owner.tracks,
        10,
        -6,
      );
      expect(comparable(candidate)).toEqual(comparable(expected));
      expect(candidate.buttonStates).toEqual(before.definition.buttonStates);
      expect(candidate.multiFramePivot).toEqual(before.definition.multiFramePivot);
      const enclosing: Project = newProject();
      enclosing.assets = state.assets;
      enclosing.symbols = state.symbols.map((s) => (s.id === candidate.id ? candidate : s));
      validateProject(enclosing);
      expect(candidate.width).toBe(before.definition.width);
      expect(candidate.height).toBe(before.definition.height);
      expect(candidate.timeline!.duration).toBe(14);
      expect(Object.hasOwn(candidate.timeline!.layers![0], 'drawingMode')).toBe(false);
      for (const track of owner.tracks) {
        const old = symbolLayers(state.definition).find((l) => l.id === track.layerId)!,
          next = symbolLayers(candidate).find((l) => l.id === track.layerId)!;
        expect(next.keys.filter((k) => [0, track.end, 12].includes(k.frame))).toEqual(
          old.keys.filter((k) => [0, track.end, 12].includes(k.frame)),
        );
        expect(next.motionSpans!.map((s) => [s.options, s.rotation])).toEqual(
          [old.motionSpans![0], old.motionSpans![0]].map((s) => [s.options, s.rotation]),
        );
        for (const original of pose.find((t) => t.layerId === track.layerId)!.key.shapes) {
          const actual = next.keys
            .find((k) => k.frame === 4)!
            .shapes.find((s) => s.id === original.id)!;
          if (!track.shapeIds.includes(original.id)) {
            expect(actual).toEqual(original);
            continue;
          }
          expect({ ...actual, x: original.x, y: original.y }).toEqual(original);
          expect(matrix(actual).slice(0, 4)).toEqual(matrix(original).slice(0, 4));
          const a = worldPoint(original, { x: 7, y: 11 }),
            b = worldPoint(actual, { x: 7, y: 11 });
          expect(b.x).toBeCloseTo(a.x + 10, 9);
          expect(b.y).toBeCloseTo(a.y - 6, 9);
        }
      }
      expect(state).toEqual(before);
      cap.dispose();
    },
  );

for (const ids of [
  ['other', 'r'],
  ['a', 'r'],
  ['e', 'a'],
  ['c', 'r', 'e'],
])
  it('promotes each original track once for ' + ids.join('/'), () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      spy = vi.spyOn(junction, 'translateRememberedEndpoint');
    const candidate = cap.prepareTranslation(
      ids.map((id) => pick('@base', id)),
      { x: 5, y: 4 },
    );
    expect(candidate.timeline!.motionSpans).toHaveLength(2);
    expect(candidate.timeline!.layers).toEqual(state.definition.timeline!.layers);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2]).toHaveLength(1);
  });

it('detaches all public scenes/choices/owners/outputs from private original membership', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
  expect(cap.choices.map((c) => [c.layerId, c.shapeId, c.definitionId])).toEqual(
    ['@base', 'extra'].flatMap((l) => ['r', 'b', 'other', 'd'].map((id) => [l, id, 'local'])),
  );
  cap.scene[0].key.shapes.splice(0);
  cap.choices.splice(0);
  const owner = cap.resolveSelection([pick('@base', 'a')]);
  owner.units[0].shapeIds.splice(0, 3, 'other');
  owner.tracks[0].shapeIds.splice(0, 3, 'other');
  owner.definitionId = 'forged';
  const result = cap.prepareTranslation([pick('@base', 'a')], { x: 5, y: 4 });
  result.timeline!.keys[3].shapes.splice(0);
  result.buttonStates!.hit = 1;
  expect(cap.resolveSelection([pick('@base', 'a')]).units[0].shapeIds).toEqual(['b', 'a', 'c']);
  expect(cap.prepareTranslation([pick('@base', 'a')], { x: 5, y: 4 }).buttonStates).toEqual(
    state.definition.buttonStates,
  );
  expect(state).toEqual(before);
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
  it('rejects malformed/overlapping isolated selections: ' + JSON.stringify(requests), () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      spy = vi.spyOn(junction, 'translateRememberedEndpoint');
    expect(() =>
      cap.prepareTranslation(requests as SampledUnitRequest[], { x: 5, y: 4 }),
    ).toThrow();
    expect(spy).not.toHaveBeenCalled();
    expect(state).toEqual(before);
    expect(cap.prepareTranslation([pick('@base', 'r')], { x: 5, y: 4 })).toBeDefined();
  });
for (const offset of [
  { x: 0, y: 0 },
  { x: NaN, y: 1 },
  { x: 1, y: Infinity },
  { x: Number.MIN_VALUE, y: 0 },
  { x: Number.MAX_VALUE, y: 0 },
  { x: '2', y: 1 },
  { y: 1 },
  null,
])
  it('rejects raw/no-op/absorbed/overflow deltas: ' + JSON.stringify(offset), () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() => cap.prepareTranslation(mixed, offset as never)).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareTranslation(mixed, { x: 5, y: 4 })).toBeDefined();
  });

for (const mode of [
  'definition-reference',
  'library-reference',
  'assets-reference',
  'revision',
  'frame',
  'membership',
  'library',
  'assets',
  'recipe',
  'interior',
  'numeric',
])
  it('invalidates after original source changes: ' + mode, () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    cap.resolveSelection(mixed);
    if (mode === 'definition-reference') state.definition = structuredClone(state.definition);
    if (mode === 'library-reference') state.symbols = [...state.symbols];
    if (mode === 'assets-reference') state.assets = [...state.assets];
    if (mode === 'revision') state.revision++;
    if (mode === 'frame') state.frame++;
    if (mode === 'membership') state.definition.shapes[1].groups = ['changed'];
    if (mode === 'library')
      state.symbols.push({ id: 'late', name: 'Late', width: 1, height: 1, shapes: [] });
    if (mode === 'assets') state.assets.push({ id: 'actual', path: 'assets/actual.bin' });
    if (mode === 'recipe') state.definition.timeline!.motionSpans![0].id = 'changed';
    if (mode === 'interior') state.definition.timeline!.keys[0].shapes[0].x++;
    if (mode === 'numeric') state.definition.shapes[0].x = NaN;
    const before = structuredClone(state);
    expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 })).toThrow();
    expect(() => cap.assertCurrent()).toThrow(/invalidated/);
    expect(state).toEqual(before);
  });

it('snapshots raw identities, offsets and enclosing callback exactly once', () => {
  const state = fixture(),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    reads = { layer: 0, id: 0, x: 0, y: 0, callback: 0 };
  cap.prepareTranslation(
    [
      {
        get layerId() {
          reads.layer++;
          return '@base';
        },
        get shapeId() {
          reads.id++;
          return 'a';
        },
      },
    ],
    {
      get x() {
        reads.x++;
        return 5;
      },
      get y() {
        reads.y++;
        return 4;
      },
    },
    {
      get validate() {
        reads.callback++;
        return () => {};
      },
    },
  );
  expect(reads).toEqual({ layer: 1, id: 1, x: 1, y: 1, callback: 1 });
});
it('snapshots source metadata once per read', () => {
  const state = fixture();
  let calls = 0,
    definition = 0,
    symbols = 0,
    assets = 0,
    revision = 0,
    frame = 0;
  const cap = captureSymbolRememberedSelectionAuthoringFrame(() => {
    calls++;
    return {
      get definition() {
        definition++;
        return state.definition;
      },
      get symbols() {
        symbols++;
        return state.symbols;
      },
      get assets() {
        assets++;
        return state.assets;
      },
      get revision() {
        revision++;
        return state.revision;
      },
      get frame() {
        frame++;
        return state.frame;
      },
    };
  });
  cap.prepareTranslation(mixed, { x: 5, y: 4 });
  expect([definition, symbols, assets, revision, frame]).toEqual(Array(5).fill(calls));
});
for (const field of ['layer', 'id', 'x', 'y', 'callback', 'length'])
  it('rejects source/request changes during getter reads: ' + field, () => {
    const state = fixture(),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      request = pick('@base', 'a'),
      requests = [request],
      offset = { x: 5, y: 4 },
      options = { validate: () => {} };
    if (field === 'layer' || field === 'id')
      Object.defineProperty(request, field === 'layer' ? 'layerId' : 'shapeId', {
        get() {
          state.revision++;
          return field === 'layer' ? '@base' : 'a';
        },
      });
    if (field === 'x' || field === 'y')
      Object.defineProperty(offset, field, {
        get() {
          state.revision++;
          return 5;
        },
      });
    if (field === 'callback')
      Object.defineProperty(options, 'validate', {
        get() {
          state.revision++;
          return () => {};
        },
      });
    if (field === 'length')
      Object.defineProperty(requests, 0, {
        get() {
          requests.push(pick('@base', 'other'));
          return request;
        },
      });
    const before = structuredClone(state.definition);
    expect(() => cap.prepareTranslation(requests, offset, options)).toThrow();
    expect(state.definition).toEqual(before);
  });
for (const method of ['scene', 'choices', 'resolve', 'prepare', 'assert', 'dispose'])
  it('rejects reentry from enclosing validation: ' + method, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    const validate = () => {
      if (method === 'scene') void cap.scene;
      if (method === 'choices') void cap.choices;
      if (method === 'resolve') cap.resolveSelection(mixed);
      if (method === 'prepare') cap.prepareTranslation(mixed, { x: 5, y: 4 });
      if (method === 'assert') cap.assertCurrent();
      if (method === 'dispose') cap.dispose();
    };
    expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 }, { validate })).toThrow();
    expect(() => cap.assertCurrent()).toThrow(/invalidated/);
    expect(state).toEqual(before);
  });
for (const validate of [
  null,
  3,
  () => Promise.resolve(),
  () => {
    throw Error('enclosing');
  },
])
  it('rejects invalid/asynchronous/failed enclosing validation without writes', () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    expect(() =>
      cap.prepareTranslation(mixed, { x: 5, y: 4 }, { validate: validate as never }),
    ).toThrow();
    expect(state).toEqual(before);
    expect(cap.prepareTranslation(mixed, { x: 5, y: 4 })).toBeDefined();
  });

it('rejects actual late library edits after every selected track has completed translation', () => {
  const state = fixture(),
    before = structuredClone(state.definition),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    translate = junction.translateRememberedEndpoint;
  let completed = false;
  vi.spyOn(junction, 'translateRememberedEndpoint').mockImplementation((...args) => {
    translate(...args);
    expect(args[0].layers.every((l) => l.motionSpans?.length === 2)).toBe(true);
    expect(args[0].layers[0].keys[4].shapes[0].x).toBe(45);
    completed = true;
    state.assets.push({ id: 'late', path: 'assets/late.bin' });
  });
  expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 })).toThrow(/changed/);
  expect(completed).toBe(true);
  expect(state.definition).toEqual(before);
});
it('rechecks original ownership after the complete detached definition clone exists', () => {
  const state = fixture(),
    before = structuredClone(state.definition),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    clone = structuredClone;
  let completed = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const out = clone(value, options),
      d = value as SymbolDefinition;
    if (!completed && d?.id === 'local' && d.timeline?.motionSpans?.length === 2) {
      completed = true;
      state.revision++;
    }
    return out;
  });
  expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 })).toThrow(/changed/);
  expect(completed).toBe(true);
  expect(state.definition).toEqual(before);
});
it('rejects source-reader reentry and explicit disposal terminally', () => {
  const state = fixture();
  let read = () => state;
  const cap = captureSymbolRememberedSelectionAuthoringFrame(() => read());
  read = () => {
    try {
      cap.assertCurrent();
    } catch {
      /* admission must reject despite a swallowed callback error */
    }
    return state;
  };
  expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 })).toThrow();
  expect(() => cap.scene).toThrow(/invalidated/);
  const fresh = captureSymbolRememberedSelectionAuthoringFrame(() => state);
  fresh.dispose();
  fresh.dispose();
  expect(() => fresh.resolveSelection(mixed)).toThrow(/invalidated/);
});

for (const mode of ['hidden', 'locked', 'merge', 'authored', 'near-start', 'near-end', 'held'])
  it('rejects non-authorable original tracks/frames: ' + mode, () => {
    const state = fixture(),
      extra = state.definition.timeline!.layers![0];
    if (mode === 'hidden') extra.visible = false;
    if (mode === 'locked') extra.locked = true;
    if (mode === 'merge') extra.drawingMode = 'merge';
    if (mode === 'authored') state.frame = 8;
    if (mode === 'near-start') state.frame = 1;
    if (mode === 'near-end') state.frame = 7;
    if (mode === 'held') state.frame = 12;
    const before = structuredClone(state);
    expect(() =>
      captureSymbolRememberedSelectionAuthoringFrame(() => state).prepareTranslation(mixed, {
        x: 5,
        y: 4,
      }),
    ).toThrow();
    expect(state).toEqual(before);
  });
for (const value of [undefined, false])
  it(
    'keeps stricter saved-option admission separate from legacy isolated promotion: ' + value,
    () => {
      const state = fixture();
      for (const layer of symbolLayers(state.definition))
        layer.motionSpans![0].rotation!.axisGroupShear = value;
      const before = structuredClone(state),
        cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
        spy = vi.spyOn(junction, 'translateRememberedEndpoint');
      expect(cap.resolveSelection(mixed).units).toHaveLength(4);
      expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 })).toThrow(/already admit/);
      expect(spy).not.toHaveBeenCalled();
      expect(
        captureSymbolRememberedAuthoringFrame(() => state).prepareGroupPromotion('@base', 'a'),
      ).toBeDefined();
      expect(state).toEqual(before);
    },
  );
it('keeps later-track guard failure atomic and permits a source-valid smaller selection', () => {
  const state = fixture();
  state.definition.timeline!.layers![0].motionSpans![0].rotation!.axisGroupShear = false;
  const before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
  expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 })).toThrow(/already admit/);
  expect(state).toEqual(before);
  expect(cap.prepareTranslation([pick('@base', 'r')], { x: 5, y: 4 })).toBeDefined();
});
it('refreshes/reopens later independent isolated selection edits without rewriting the earlier junction', () => {
  const state = fixture('reflected'),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    first = cap.prepareTranslation(mixed, { x: 5, y: 4 });
  cap.dispose();
  const definition = JSON.parse(JSON.stringify(first)) as SymbolDefinition,
    next = { ...state, definition, symbols: [definition], revision: 3, frame: 6 },
    before = structuredClone(next);
  const later = captureSymbolRememberedSelectionAuthoringFrame(() => next),
    result = later.prepareTranslation([pick('@base', 'r'), pick('extra', 'a')], { x: -3, y: 2 });
  for (const layer of symbolLayers(result))
    expect(layer.keys.find((k) => k.frame === 4)).toEqual(
      symbolLayers(before.definition)
        .find((l) => l.id === layer.id)!
        .keys.find((k) => k.frame === 4),
    );
  expect(next).toEqual(before);
});

for (const field of [
  'missing-assets',
  'missing-library-target',
  'duplicate',
  'nonfinite',
  'invalid-original-library',
])
  it(
    'requires original complete resource/library admission before private ownership: ' + field,
    () => {
      const state = fixture();
      if (field === 'missing-assets')
        delete (state as Partial<SymbolSelectionAuthoringSource>).assets;
      if (field === 'missing-library-target') state.symbols = [];
      if (field === 'duplicate') state.symbols.push(structuredClone(state.definition));
      if (field === 'nonfinite') state.definition.shapes[0].x = NaN;
      if (field === 'invalid-original-library') {
        state.symbols = [structuredClone(state.definition)];
        state.symbols[0].width = -1;
      }
      expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow();
    },
  );
it('requires actual bitmap metadata rather than forging resources, preserving the complete assets and library', () => {
  const state = fixture();
  state.assets = [
    {
      id: 'bitmap',
      path: 'assets/bitmaps/actual.json',
      bitmap: { name: 'Actual', width: 12, height: 12 },
    },
  ];
  for (const layer of symbolLayers(state.definition)) {
    for (const key of layer.keys.filter(
      (k) => k.frame === 0 || k.frame === (layer.id === '@base' ? 8 : 10),
    ))
      key.shapes[0].bitmap = { assetId: 'bitmap', x: 0, y: 0, width: 12, height: 12, repeat: true };
    const p = newProject();
    p.duration = 14;
    p.assets = state.assets;
    p.layers = [layer];
    refreshBasicMotionSpan(p, [layer.id], 0, layer.id === '@base' ? 8 : 10);
    if (layer.id === '@base') {
      state.definition.shapes = layer.keys[0].shapes;
      state.definition.timeline!.keys = layer.keys.slice(1);
      state.definition.timeline!.motionSpans = layer.motionSpans;
    }
  }
  const before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    candidate = cap.prepareTranslation(mixed, { x: 5, y: 4 });
  expect(symbolLayers(candidate)[0].keys[4].shapes[0].bitmap).toEqual(
    cap.scene[0].key.shapes[0].bitmap,
  );
  expect(state).toEqual(before);
  cap.dispose();
  state.assets = [];
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow();
});

it('admits exact full-library artwork capacity and rejects original overflow', () => {
  const state = fixture(),
    count = symbolArtworks(state.definition).reduce((n, a) => n + a.length, 0);
  state.symbols.push({
    id: 'spare',
    name: 'Spare',
    width: 1,
    height: 1,
    shapes: Array.from({ length: MAX_SYMBOL_ARTWORK - count }, (_, i) => ({
      ...ink('art-' + i, 0),
      width: 1,
      height: 1,
    })),
  });
  const cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    candidate = cap.prepareTranslation(mixed, { x: 5, y: 4 });
  expect(symbolArtworks(candidate).reduce((n, a) => n + a.length, 0)).toBe(count);
  cap.dispose();
  const original = state.definition;
  state.definition = structuredClone(original);
  state.definition.shapes.push(ink('draft-overflow', 0));
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(
    /symbol artwork budget/,
  );
  state.definition = original;
  state.symbols[1].shapes.push(ink('overflow', 0));
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(
    /symbol artwork budget/,
  );
}, 60000);

for (const basis of ['plain', 'reflected'])
  it('retains aligned unequal compound rings in mixed root/group tracks: ' + basis, () => {
    const p = newProject();
    p.duration = 12;
    const layer = p.layers[0];
    layer.id = '@base';
    const shapes = ['r', 'b', 'a'].map((id, i): Vector => ({
      ...ink(id, i * 35, i ? ['outer', ...(i === 2 ? ['inner'] : [])] : undefined),
      kind: 'polygon',
      closed: true,
      fillRule: 'evenodd',
      rotation: basis === 'reflected' ? 25 : 0,
      ...(basis === 'reflected'
        ? { transform: [-1.3, 0.2, 0.4, 0.8] as [number, number, number, number] }
        : {}),
      contours: [
        [
          [0, 0],
          [20, 0],
          [20, 20],
          [0, 20],
        ],
        [
          [5, 5],
          [5, 9],
          [9, 5],
        ],
      ].map((r) => r.map(([x, y]) => ({ x, y, in: { x: x - 0.2, y }, out: { x: x + 0.2, y } }))),
    }));
    const end = shapes.map((s) => ({
      ...structuredClone(s),
      x: s.x + 80,
      contours: [...s.contours!]
        .reverse()
        .map((r) =>
          [r[1], r[0], ...r.slice(2).reverse()].map((n) => ({ ...n, in: n.out, out: n.in })),
        ),
    }));
    layer.keys = [
      { frame: 0, shapes },
      { frame: 8, shapes: end },
      { frame: 10, shapes: [] },
    ];
    const correspondence = { order: [1, 0], start: [1, 1], reverse: [true, true] };
    createBasicMotionSpan(
      p,
      ['@base'],
      0,
      8,
      'linear',
      { nodes: true, affine: true },
      undefined,
      undefined,
      correspondence,
    );
    const extra = { ...structuredClone(layer), id: 'extra' };
    const definition: SymbolDefinition = {
      id: 'aligned',
      name: 'Aligned',
      width: 400,
      height: 240,
      shapes: layer.keys[0].shapes,
      timeline: {
        duration: 12,
        keys: layer.keys.slice(1),
        motionSpans: layer.motionSpans,
        layers: [extra],
      },
    };
    const state = { definition, symbols: [definition], assets: [], frame: 4, revision: 0 },
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state);
    const scene = cap.scene,
      result = cap.prepareTranslation([pick('@base', 'r'), pick('extra', 'a')], { x: 5, y: 4 });
    for (const [layerId, ids] of [
      ['@base', ['r']],
      ['extra', ['b', 'a']],
    ] as const) {
      const track = symbolLayers(result).find((l) => l.id === layerId)!;
      for (const id of ids) {
        const original = scene
            .find((t) => t.layerId === layerId)!
            .key.shapes.find((s) => s.id === id)!,
          actual = track.keys[4].shapes.find((s) => s.id === id)!;
        expect(actual.contours).toEqual(original.contours);
        expect({ ...actual, x: original.x, y: original.y }).toEqual(original);
        expect(worldPoint(actual, actual.contours![1][2]).x).toBeCloseTo(
          worldPoint(original, original.contours![1][2]).x + 5,
          9,
        );
      }
      expect(track.motionSpans![1].correspondence).toEqual(correspondence);
      expect(track.keys.filter((k) => [0, 8, 10].includes(k.frame))).toEqual(
        symbolLayers(before.definition)
          .find((l) => l.id === layerId)!
          .keys.filter((k) => [0, 8, 10].includes(k.frame)),
      );
    }
    expect(state).toEqual(before);
  });

for (const value of ['absent', 'undefined', 'empty'])
  it('preserves the original optional additional-track representation: ' + value, () => {
    const state = fixture();
    if (value === 'absent') delete state.definition.timeline!.layers;
    else state.definition.timeline!.layers = value === 'empty' ? [] : undefined;
    const before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      result = cap.prepareTranslation([pick('@base', 'r'), pick('@base', 'a')], { x: 5, y: 4 });
    expect(Object.hasOwn(result.timeline!, 'layers')).toBe(
      Object.hasOwn(state.definition.timeline!, 'layers'),
    );
    expect(result.timeline!.layers).toStrictEqual(state.definition.timeline!.layers);
    expect(state).toEqual(before);
  });
for (const options of [undefined, {}, { affine: false }, { affine: true }])
  it(
    'preserves omitted/default/explicit options for ungrouped selections: ' +
      JSON.stringify(options),
    () => {
      const state = fixture();
      delete state.definition.timeline!.layers;
      const layer = symbolLayers(state.definition)[0];
      layer.keys = layer.keys.filter((k) => [0, 8, 12].includes(k.frame));
      delete layer.motionSpans;
      for (const key of layer.keys)
        key.shapes = key.shapes.filter((s) => ['r', 'other'].includes(s.id));
      const p = newProject();
      p.duration = 14;
      p.layers = [layer];
      createBasicMotionSpan(p, ['@base'], 0, 8, 'linear', options);
      state.definition.shapes = layer.keys[0].shapes;
      state.definition.timeline!.keys = layer.keys.slice(1);
      state.definition.timeline!.motionSpans = layer.motionSpans;
      const before = structuredClone(state),
        cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
        result = cap.prepareTranslation([pick('@base', 'other'), pick('@base', 'r')], {
          x: 5,
          y: 4,
        });
      expect(result.timeline!.motionSpans!.map((s) => s.options)).toEqual([options, options]);
      expect(state).toEqual(before);
    },
  );
for (const mode of ['options', 'rotation'])
  it('rechecks saved admission after complete all-track regeneration: ' + mode, () => {
    const state = fixture(),
      before = structuredClone(state),
      cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
      translate = junction.translateRememberedEndpoint;
    let completed = false;
    vi.spyOn(junction, 'translateRememberedEndpoint').mockImplementation((...args) => {
      translate(...args);
      const span = args[0].layers[1].motionSpans!.find((s) => s.start === 4)!;
      if (mode === 'options') span.options!.affine = false;
      else span.rotation!.axisGroupShear = false;
      completed = true;
    });
    expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 })).toThrow(/already admit/);
    expect(completed).toBe(true);
    expect(state).toEqual(before);
  });
it('rejects actual later-track coordinate overflow after the complete combined kernel without writes', () => {
  const state = fixture(),
    extra = state.definition.timeline!.layers![0];
  for (const frame of [0, 10])
    extra.keys.find((k) => k.frame === frame)!.shapes.find((s) => s.id === 'r')!.x = 9e6;
  const p = newProject();
  p.duration = 14;
  p.layers = [extra];
  p.symbols = state.symbols;
  refreshBasicMotionSpan(p, ['extra'], 0, 10);
  const before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    translate = junction.translateRememberedEndpoint;
  let completed = false;
  vi.spyOn(junction, 'translateRememberedEndpoint').mockImplementation((...args) => {
    translate(...args);
    expect(args[0].layers[1].keys[4].shapes[0].x).toBe(11e6);
    completed = true;
  });
  expect(() =>
    cap.prepareTranslation([pick('@base', 'r'), pick('extra', 'r')], { x: 2e6, y: 0 }),
  ).toThrow(/shape geometry/);
  expect(completed).toBe(true);
  expect(state).toEqual(before);
});
it('admits original source again after final replacement metadata reads', () => {
  let state = fixture(),
    reads = 0;
  const probe = captureSymbolRememberedSelectionAuthoringFrame(() => {
      reads++;
      return state;
    }),
    start = reads;
  probe.prepareTranslation(mixed, { x: 5, y: 4 });
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
  expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 })).toThrow(/changed/);
  expect(state.assets.at(-1)!.id).toBe('final');
});
it('rejects replacement aggregate overflow after the final detached definition clone, leaving a valid source retry', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    clone = structuredClone;
  let completed = false;
  const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const out = clone(value, options),
      d = out as SymbolDefinition;
    if (!completed && d?.id === 'local' && d.timeline?.motionSpans?.length === 2) {
      completed = true;
      d.shapes = [...d.shapes, ...Array.from({ length: 50000 }, (_, i) => ink('extra-' + i, 0))];
      d.timeline.keys.push({
        frame: 13,
        shapes: Array.from({ length: 50000 }, (_, i) => ink('extra-' + i, 0)),
      });
    }
    return out;
  });
  expect(() => cap.prepareTranslation(mixed, { x: 5, y: 4 })).toThrow(/symbol artwork budget/);
  expect(completed).toBe(true);
  expect(state).toEqual(before);
  spy.mockRestore();
  expect(cap.prepareTranslation(mixed, { x: 5, y: 4 })).toBeDefined();
});

it('checks enclosing ownership after completed cloning and permits a fresh source-valid retry', () => {
  const state = fixture(),
    before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    clone = structuredClone;
  let valid = true,
    completed = false;
  const spy = vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const out = clone(value, options),
      d = value as SymbolDefinition;
    if (!completed && d?.id === 'local' && d.timeline?.motionSpans?.length === 2) {
      completed = true;
      valid = false;
    }
    return out;
  });
  expect(() =>
    cap.prepareTranslation(
      mixed,
      { x: 5, y: 4 },
      {
        validate() {
          if (!valid) throw Error('enclosing changed');
        },
      },
    ),
  ).toThrow(/enclosing changed/);
  expect(completed).toBe(true);
  expect(state).toEqual(before);
  spy.mockRestore();
  valid = true;
  expect(cap.prepareTranslation(mixed, { x: 5, y: 4 })).toBeDefined();
});
it('rechecks raw resource ownership after the initial source clone', () => {
  const state = fixture(),
    before = structuredClone(state.definition),
    clone = structuredClone;
  let completed = false;
  vi.spyOn(globalThis, 'structuredClone').mockImplementation((value, options) => {
    const out = clone(value, options);
    if (!completed && value === state.definition) {
      completed = true;
      state.assets = [...state.assets];
    }
    return out;
  });
  expect(() => captureSymbolRememberedSelectionAuthoringFrame(() => state)).toThrow(/changed/);
  expect(completed).toBe(true);
  expect(state.definition).toEqual(before);
});

it('keeps explicit undefined drawing mode on an untouched additional track', () => {
  const state = fixture();
  state.definition.timeline!.layers![0].drawingMode = undefined;
  const before = structuredClone(state),
    cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
    result = cap.prepareTranslation([pick('@base', 'r')], { x: 5, y: 4 });
  expect(result.timeline!.layers).toStrictEqual(before.definition.timeline!.layers);
  expect(Object.hasOwn(result.timeline!.layers![0], 'drawingMode')).toBe(true);
  expect(state).toEqual(before);
});

for (const bounds of [
  [0, 0],
  [0.5, 2.25],
  [1e6, 20000],
])
  it(
    'keeps valid original symbol bounds independent of internal root stage limits: ' +
      bounds.join('/'),
    () => {
      const state = fixture();
      [state.definition.width, state.definition.height] = bounds;
      const before = structuredClone(state),
        cap = captureSymbolRememberedSelectionAuthoringFrame(() => state),
        result = cap.prepareTranslation(mixed, { x: 5, y: 4 });
      expect([result.width, result.height]).toEqual(bounds);
      expect(state).toEqual(before);
    },
  );
