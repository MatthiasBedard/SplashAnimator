import { reverseBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { splitCubicMotionPath, splitPreservedMotionPath, createMotionPathSampler, motionPathPosition } from '../packages/animation/src/motion-path';
import { motionProgress } from '../packages/animation/src/motion-frames';
import { expect, it } from 'vitest';
import { clone, migrateProject, newProject, validateProject } from '../packages/document/src';
import {
  splitSimpleMotionEase,
  splitBasicMotionSpan,
  parseMotionSpanLengths,
  moveBasicMotionSpan,
  setBasicMotionSpanAutoRefresh,
  refreshChangedBasicMotionSpans,
  refreshChangedSymbolMotionSpans,
  editSymbolBasicMotionSpan,
  retimeBasicMotionSpan,
  createBasicMotionSpan,
  detachBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';

function fixture() {
  const p = newProject();
  p.duration = 8;
  const shape = {
    id: 'art',
    kind: 'rectangle' as const,
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [shape] },
    { frame: 4, shapes: [{ ...shape, x: 80 }] },
  ];
  return p;
}
it('remembers, refreshes and detaches basic motion without replacing authored keys', () => {
  const p = fixture(),
    source = clone(p.layers[0].keys[0]);
  const ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  expect(p.layers[0].keys[2].shapes[0].x).toBe(40);
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  loaded.layers[0].keys[4].shapes[0].x = 160;
  const end = clone(loaded.layers[0].keys[4]);
  refreshBasicMotionSpan(loaded, ids, 0, 4);
  expect(loaded.layers[0].keys[2].shapes[0].x).toBe(80);
  expect(loaded.layers[0].keys[0]).toEqual(source);
  expect(loaded.layers[0].keys[4]).toEqual(end);
  const keys = clone(loaded.layers[0].keys);
  detachBasicMotionSpan(loaded, ids, 0, 4);
  expect(loaded.layers[0].motionSpans).toBeUndefined();
  expect(loaded.layers[0].keys).toEqual(keys);
  expect(p.layers[0].keys[2].shapes[0].x).toBe(40);
});
it('rejects changed interiors, protected later tracks and invalid original endpoints atomically', () => {
  for (const mode of ['edited', 'removed', 'locked', 'invalid'] as const) {
    const p = fixture();
    p.layers.push({ ...clone(p.layers[0]), id: 'later' });
    const ids = p.layers.map((l) => l.id);
    createBasicMotionSpan(p, ids, 0, 4, 'in-out');
    p.layers[0].keys[4].shapes[0].x = 160;
    if (mode === 'edited') p.layers[1].keys[2].shapes[0].y++;
    if (mode === 'removed') p.layers[1].keys.splice(2, 1);
    if (mode === 'locked') p.layers[1].locked = true;
    if (mode === 'invalid') p.layers[1].keys[4].shapes[0].x = NaN;
    const before = structuredClone(p);
    expect(() => refreshBasicMotionSpan(p, ids, 0, 4)).toThrow();
    expect(p).toEqual(before);
  }
});
it('migrates schema 28 pivots intact and rejects malformed recipe metadata', () => {
  const p = fixture();
  p.multiFramePivot = { x: 12, y: 9 };
  createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'out');
  const upgraded = migrateProject({ ...p, schemaVersion: 28 });
  expect(upgraded.multiFramePivot).toEqual(p.multiFramePivot);
  expect(upgraded.layers[0].motionSpans).toBeUndefined();
  for (const field of ['end', 'ease', 'baseline'] as const) {
    const bad = clone(p);
    Object.assign(bad.layers[0].motionSpans![0], { [field]: null });
    expect(() => validateProject(bad)).toThrow();
  }
  const before = clone(p);
  expect(() => createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear')).toThrow('overlap');
  expect(p).toEqual(before);
});

it('preserves base and additional symbol recipes across validation, refresh and detach', () => {
  const p = fixture(),
    layer = clone(p.layers[0]);
  const d = {
    id: 'symbol',
    name: 'Motion',
    width: 100,
    height: 100,
    shapes: layer.keys[0].shapes,
    buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
    timeline: { duration: 8, keys: layer.keys.slice(1), layers: [{ ...layer, id: 'extra' }] },
  };
  const before = clone(d);
  let result = editSymbolBasicMotionSpan(d, ['@base', 'extra'], 0, 4, 'create');
  expect(d).toEqual(before);
  p.symbols = [result];
  result = migrateProject(JSON.parse(JSON.stringify(p))).symbols![0];
  expect(result.timeline!.motionSpans).toHaveLength(1);
  const malformed = clone(p);
  Object.assign(malformed.symbols![0].timeline!, { motionSpans: null });
  expect(() => validateProject(malformed)).toThrow('motion spans');
  expect(result.timeline!.layers![0].motionSpans).toHaveLength(1);
  result.timeline!.keys[3].shapes[0].x = 160;
  result.timeline!.layers![0].keys[4].shapes[0].x = 240;
  const refreshed = editSymbolBasicMotionSpan(result, ['@base', 'extra'], 0, 4, 'refresh');
  expect(refreshed.timeline!.keys[1].shapes[0].x).toBe(80);
  expect(refreshed.timeline!.layers![0].keys[2].shapes[0].x).toBe(120);
  expect(refreshed.buttonStates).toEqual(before.buttonStates);
  const detached = editSymbolBasicMotionSpan(refreshed, ['@base', 'extra'], 0, 4, 'detach');
  expect(detached.timeline!.motionSpans).toBeUndefined();
  expect(detached.timeline!.layers![0].motionSpans).toBeUndefined();
  expect(detached.timeline!.keys).toEqual(refreshed.timeline!.keys);
  const old = migrateProject({ ...p, schemaVersion: 29 });
  expect(old.symbols![0].timeline!.motionSpans).toBeUndefined();
  expect(old.symbols![0].timeline!.layers![0].motionSpans).toHaveLength(1);
});
it('rejects later symbol conflicts and aggregate artwork capacity without mutating originals', () => {
  const p = fixture(),
    layer = clone(p.layers[0]);
  const d = {
    id: 'symbol',
    name: 'Motion',
    width: 100,
    height: 100,
    shapes: layer.keys[0].shapes,
    timeline: { duration: 8, keys: layer.keys.slice(1), layers: [{ ...layer, id: 'extra' }] },
  };
  const result = editSymbolBasicMotionSpan(d, ['@base', 'extra'], 0, 4, 'create');
  result.timeline!.layers![0].keys[2].shapes[0].x++;
  const before = clone(result);
  expect(() => editSymbolBasicMotionSpan(result, ['@base', 'extra'], 0, 4, 'refresh')).toThrow(
    'Generated keys changed',
  );
  expect(result).toEqual(before);
  const crowded = {
    ...d,
    id: 'crowded',
    timeline: undefined,
    shapes: Array(99996).fill(layer.keys[0].shapes[0]),
  };
  expect(() =>
    editSymbolBasicMotionSpan(d, ['@base'], 0, 4, 'create', 'linear', [d, crowded]),
  ).toThrow('budget');
  expect(d.timeline.keys).toEqual(layer.keys.slice(1));
});

it('automatically prepares shared-endpoint spans together and leaves conflicts untouched', () => {
  const p = fixture();
  p.duration = 9;
  p.layers[0].keys.push({ frame: 8, shapes: [{ ...p.layers[0].keys[0].shapes[0], x: 160 }] });
  const ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  createBasicMotionSpan(p, ids, 4, 8, 'linear');
  const before = clone(p);
  p.layers[0].keys[4].shapes[0].x = 120;
  refreshChangedBasicMotionSpans(before, p);
  expect(p.layers[0].keys[2].shapes[0].x).toBe(60);
  expect(p.layers[0].keys[6].shapes[0].x).toBe(140);
  const previous = clone(p);
  p.layers[0].keys[4].shapes[0].x = 100;
  p.layers[0].keys[6].shapes[0].y = 5;
  const edited = clone(p);
  expect(() => refreshChangedBasicMotionSpans(previous, p)).toThrow('Generated keys changed');
  expect(p).toEqual(edited);
  // Detachment, new recipes and edits away from endpoints do not regenerate anything.
  const detached = clone(edited);
  delete detached.layers[0].motionSpans;
  refreshChangedBasicMotionSpans(edited, detached);
  expect(detached.layers[0].keys).toEqual(edited.layers[0].keys);
});
it('automatically refreshes detached symbol endpoints without normalizing later invalid originals', () => {
  const p = fixture(),
    layer = clone(p.layers[0]);
  const d = {
    id: 'symbol',
    name: 'Motion',
    width: 100,
    height: 100,
    shapes: layer.keys[0].shapes,
    timeline: { duration: 8, keys: layer.keys.slice(1), layers: [{ ...layer, id: 'extra' }] },
  };
  const before = editSymbolBasicMotionSpan(d, ['@base', 'extra'], 0, 4, 'create');
  const edited = clone(before);
  edited.timeline!.keys[3].shapes[0].x = 160;
  edited.timeline!.layers![0].keys[4].shapes[0].x = 240;
  const result = refreshChangedSymbolMotionSpans(before, edited, [before]);
  expect(result.timeline!.keys[1].shapes[0].x).toBe(80);
  expect(result.timeline!.layers![0].keys[2].shapes[0].x).toBe(120);
  expect(edited.timeline!.keys[1].shapes[0].x).toBe(40);
  edited.timeline!.layers![0].keys[4].shapes[0].x = Infinity;
  const original = structuredClone(edited);
  expect(() => refreshChangedSymbolMotionSpans(before, edited, [before])).toThrow();
  expect(edited).toEqual(original);
});

it('retimes remembered interiors by regeneration, preserving target artwork, IDs and outside timing', () => {
  const p = fixture(),
    ids = [p.layers[0].id];
  p.layers[0].keys.push({ frame: 7, shapes: [] });
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  const target = clone(p.layers[0].keys[4].shapes),
    spanId = p.layers[0].motionSpans![0].id;
  retimeBasicMotionSpan(p, ids, 0, 4, 7);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(p.layers[0].keys[3].shapes[0].x).toBe(40);
  expect(p.layers[0].keys[6].shapes).toEqual(target);
  expect(p.layers[0].motionSpans![0]).toMatchObject({
    id: spanId,
    start: 0,
    end: 6,
    ease: 'linear',
  });
  retimeBasicMotionSpan(p, ids, 0, 6, 3);
  expect(p.layers[0].keys.map((k) => k.frame)).toEqual([0, 1, 2, 7]);
  expect(p.layers[0].keys[1].shapes[0].x).toBe(40);
  expect(p.duration).toBe(8);
  p.layers[0].keys[2].shapes[0].x = 160;
  refreshBasicMotionSpan(p, ids, 0, 2);
  expect(p.layers[0].keys[1].shapes[0].x).toBe(80);
});
it('rejects retime collisions, shared targets, conflicts, invalid lengths and later tracks atomically', () => {
  for (const failure of [
    'collision',
    'shared',
    'conflict',
    'locked',
    'invalid',
    'short',
    'long',
  ] as const) {
    const p = fixture();
    p.duration = 10;
    p.layers.push({ ...clone(p.layers[0]), id: 'later' });
    const ids = p.layers.map((l) => l.id);
    createBasicMotionSpan(p, ids, 0, 4, 'linear');
    const later = p.layers[1];
    if (failure === 'collision') later.keys.push({ frame: 5, shapes: [] });
    if (failure === 'shared') {
      later.keys.push({ frame: 8, shapes: clone(later.keys[4].shapes) });
      createBasicMotionSpan(p, ['later'], 4, 8, 'linear');
    }
    if (failure === 'conflict') later.keys[2].shapes[0].x++;
    if (failure === 'locked') later.locked = true;
    if (failure === 'invalid') later.keys[4].shapes[0].x = Infinity;
    const before = structuredClone(p);
    expect(() =>
      retimeBasicMotionSpan(p, ids, 0, 4, failure === 'short' ? 2 : failure === 'long' ? 11 : 7),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('retimes symbol base and additional recipes with fixed mappings and aggregate capacity', () => {
  const p = fixture(),
    layer = clone(p.layers[0]);
  const d = {
    id: 'symbol',
    name: 'Motion',
    width: 100,
    height: 100,
    shapes: layer.keys[0].shapes,
    buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
    timeline: { duration: 8, keys: layer.keys.slice(1), layers: [{ ...layer, id: 'extra' }] },
  };
  const source = editSymbolBasicMotionSpan(d, ['@base', 'extra'], 0, 4, 'create');
  const resized = editSymbolBasicMotionSpan(
    source,
    ['@base', 'extra'],
    0,
    4,
    'retime',
    'linear',
    [source],
    7,
  );
  expect(resized.timeline!.keys[2].shapes[0].x).toBe(40);
  expect(resized.timeline!.layers![0].keys[3].shapes[0].x).toBe(40);
  expect(resized.buttonStates).toEqual(source.buttonStates);
  expect(resized.timeline!.duration).toBe(8);
  expect(source.timeline!.motionSpans![0].end).toBe(4);
  const crowded = {
    ...d,
    id: 'crowded',
    timeline: undefined,
    shapes: Array(99990).fill(d.shapes[0]),
  };
  expect(() =>
    editSymbolBasicMotionSpan(
      source,
      ['@base', 'extra'],
      0,
      4,
      'retime',
      'linear',
      [source, crowded],
      7,
    ),
  ).toThrow('budget');
});

it('ripple retimes shared spans and following blank keys without changing their artwork or easing', () => {
  const p = fixture();
  p.duration = 14;
  const layer = p.layers[0],
    ids = [layer.id];
  layer.keys.push(
    { frame: 8, shapes: [{ ...layer.keys[0].shapes[0], x: 160 }] },
    { frame: 10, shapes: [] },
  );
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  createBasicMotionSpan(p, ids, 4, 8, 'in');
  const old = clone(layer),
    following = clone(layer.keys.filter((k) => k.frame >= 4));
  retimeBasicMotionSpan(p, ids, 0, 4, 7, true);
  expect(layer.motionSpans![1]).toMatchObject({
    id: old.motionSpans![1].id,
    start: 6,
    end: 10,
    ease: 'in',
  });
  expect(layer.keys.filter((k) => k.frame >= 6)).toEqual(
    following.map((k) => ({ ...k, frame: k.frame + 2 })),
  );
  layer.keys.find((k) => k.frame === 10)!.shapes[0].x = 240;
  refreshBasicMotionSpan(p, ids, 6, 10);
  expect(layer.keys.find((k) => k.frame === 8)!.shapes[0].x).toBe(120);
  retimeBasicMotionSpan(p, ids, 0, 6, 3, true);
  expect(layer.motionSpans![1]).toMatchObject({ start: 2, end: 6 });
  expect(layer.keys.at(-1)).toEqual({ frame: 8, shapes: [] });
  expect(p.duration).toBe(14);
});
it('rejects ripple overflow and later following-span conflicts before writing any track', () => {
  for (const conflict of [false, true]) {
    const p = fixture();
    p.duration = conflict ? 20 : 10;
    const layer = p.layers[0];
    layer.keys.push({ frame: 8, shapes: clone(layer.keys[0].shapes) });
    p.layers.push({ ...clone(layer), id: 'later' });
    const ids = p.layers.map((l) => l.id);
    createBasicMotionSpan(p, ids, 0, 4, 'linear');
    createBasicMotionSpan(p, ids, 4, 8, 'linear');
    if (conflict) p.layers[1].keys[6].shapes[0].y++;
    const before = clone(p);
    expect(() => retimeBasicMotionSpan(p, ids, 0, 4, 7, true)).toThrow(
      conflict ? 'Following generated keys changed' : 'duration',
    );
    expect(p).toEqual(before);
  }
});

it('persists property options and reuses them on refresh, automatic updates and retiming', () => {
  const p = fixture(),
    ids = [p.layers[0].id];
  const target = p.layers[0].keys[1].shapes[0];
  Object.assign(target, { width: 40, fill: '#0000ff', strokeWidth: 4, transform: [3, 0, 0, 1] });
  const options = { affine: true, paint: true, primitives: true, strokeWidth: true };
  createBasicMotionSpan(p, ids, 0, 4, 'linear', options);
  options.paint = false;
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  const midpoint = loaded.layers[0].keys[2].shapes[0];
  expect(midpoint.width).toBe(30);
  expect(midpoint.fill).toBe('#800080');
  expect(midpoint.strokeWidth).toBe(2);
  expect(midpoint.transform).toEqual([2, 0, 0, 1]);
  loaded.layers[0].keys[4].shapes[0].width = 60;
  refreshBasicMotionSpan(loaded, ids, 0, 4);
  expect(loaded.layers[0].keys[2].shapes[0].width).toBe(40);
  const before = clone(loaded);
  loaded.layers[0].keys[4].shapes[0].width = 80;
  refreshChangedBasicMotionSpans(before, loaded);
  expect(loaded.layers[0].keys[2].shapes[0].width).toBe(50);
  retimeBasicMotionSpan(loaded, ids, 0, 4, 7);
  expect(loaded.layers[0].keys[3].shapes[0].width).toBe(50);
  expect(loaded.layers[0].motionSpans![0].options!.paint).toBe(true);
  const legacy = migrateProject({ ...p, schemaVersion: 30 });
  expect(legacy.layers[0].motionSpans![0].options).toBeUndefined();
});
it('rejects malformed remembered property options before writes and on load', () => {
  for (const options of [null, [], { affine: 1 }, { unknown: true }]) {
    const p = fixture(),
      before = clone(p);
    expect(() =>
      createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear', options as never),
    ).toThrow('motion span options');
    expect(p).toEqual(before);
    createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear');
    Object.assign(p.layers[0].motionSpans![0], { options });
    expect(() => validateProject(p)).toThrow('motion span options');
  }
});

it('stores node and gradient geometry/basis options and rejects later original invalid values', () => {
  const p = fixture(),
    ids = [p.layers[0].id];
  for (const key of p.layers[0].keys)
    Object.assign(key.shapes[0], {
      kind: 'bezier',
      nodes: [
        { x: 0, y: 0 },
        { x: key.frame ? 40 : 20, y: 20 },
      ],
      gradient: {
        kind: 'linear',
        from: { x: 0, y: 0 },
        to: { x: key.frame ? 40 : 20, y: 0 },
        transform: [key.frame ? 3 : 1, 0, 0, 1],
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff' },
        ],
      },
    });
  createBasicMotionSpan(p, ids, 0, 4, 'linear', {
    nodes: true,
    gradientGeometry: true,
    gradientBasis: true,
  });
  const mid = p.layers[0].keys[2].shapes[0];
  expect(mid.nodes![1].x).toBe(30);
  expect(mid.gradient!.to.x).toBe(30);
  expect(mid.gradient!.transform).toEqual([2, 0, 0, 1]);
  p.layers.push({ ...clone(p.layers[0]), id: 'later' });
  p.layers[1].keys[4].shapes[0].gradient!.transform![0] = Infinity;
  const before = structuredClone(p);
  expect(() => refreshBasicMotionSpan(p, [ids[0], 'later'], 0, 4)).toThrow();
  expect(p).toEqual(before);
});

it('retains detached paths through reopen, endpoint auto-refresh and retiming', () => {
  const p = fixture(),
    ids = [p.layers[0].id];
  const path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  createBasicMotionSpan(p, ids, 0, 4, 'linear', undefined, path);
  expect(p.layers[0].keys[2].shapes[0]).toMatchObject({ x: 40, y: 30 });
  path.startY = 999;
  const loaded = migrateProject(JSON.parse(JSON.stringify(p))),
    before = clone(loaded);
  loaded.layers[0].keys[4].shapes[0].x = 160;
  refreshChangedBasicMotionSpans(before, loaded);
  expect(loaded.layers[0].keys[2].shapes[0]).toMatchObject({ x: 80, y: 30 });
  retimeBasicMotionSpan(loaded, ids, 0, 4, 7);
  expect(loaded.layers[0].keys[3].shapes[0]).toMatchObject({ x: 80, y: 30 });
  expect(loaded.layers[0].motionSpans![0].path).toEqual({ ...path, startY: 40 });
  const old = migrateProject({ ...p, schemaVersion: 31 });
  expect(old.layers[0].motionSpans![0].path).toBeUndefined();
  expect(old.layers[0].keys).toEqual(p.layers[0].keys);
});
it('rejects malformed stored and original paths without writing any track', () => {
  const p = fixture(),
    ids = [p.layers[0].id],
    before = structuredClone(p);
  expect(() =>
    createBasicMotionSpan(p, ids, 0, 4, 'linear', undefined, {
      startX: 0,
      startY: Infinity,
      endX: 0,
      endY: 0,
    }),
  ).toThrow();
  expect(p).toEqual(before);
  expect(() => createBasicMotionSpan(p, ids, 0, 4, 'linear', undefined, null as never)).toThrow();
  expect(p).toEqual(before);
  createBasicMotionSpan(p, ids, 0, 4, 'linear', undefined, {
    startX: 0,
    startY: 40,
    endX: 0,
    endY: 40,
  });
  p.layers[0].motionSpans![0].path!.waypointIncoming = [{ x: 0, y: 0 }];
  expect(() => validateProject(p)).toThrow();
});

it.each(['straight', 'linked', 'independent'] as const)(
  'reopens and refreshes stored %s waypoint recipes',
  (mode) => {
    const p = fixture(),
      ids = [p.layers[0].id];
    const path = {
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      waypoints: [{ x: 40, y: 20 }],
      distance: true,
      ...(mode === 'straight'
        ? {}
        : {
            curvedWaypoints: true,
            tangent: true,
            waypointTangents: [
              { x: 10, y: 0 },
              { x: 10, y: 0 },
              { x: -10, y: 0 },
            ],
            ...(mode === 'independent' ? { waypointIncoming: [{ x: -5, y: 0 }] } : {}),
          }),
    };
    createBasicMotionSpan(p, ids, 0, 4, 'linear', undefined, path);
    const saved = JSON.parse(JSON.stringify(p));
    path.waypoints[0].y = 999;
    const loaded = migrateProject(saved);
    refreshBasicMotionSpan(loaded, ids, 0, 4);
    expect(loaded.layers[0].keys).toEqual(saved.layers[0].keys);
    expect(loaded.layers[0].motionSpans![0].path!.waypoints![0].y).toBe(20);
  },
);

it('retains group axis scaling, shear and detached pivots through reload and retiming', () => {
  const p = fixture(),
    ids = [p.layers[0].id];
  for (const key of p.layers[0].keys) {
    key.shapes[0].groups = ['pair'];
    key.shapes.push({
      ...key.shapes[0],
      id: 'member',
      x: key.frame ? 125 : 20,
      y: key.frame ? 5 : 10,
    });
    if (key.frame) for (const shape of key.shapes) shape.transform = [2, 0, 0.5, 0.5];
  }
  const rotation = {
    direction: 'shortest' as const,
    turns: 0,
    rigidGroups: true,
    axisGroupScale: true,
    axisGroupShear: true,
    rigidPivot: { x: 4, y: 3 },
  };
  createBasicMotionSpan(p, ids, 0, 4, 'linear', { affine: true }, undefined, rotation);
  rotation.rigidPivot.x = 999;
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  retimeBasicMotionSpan(loaded, ids, 0, 4, 7);
  expect(loaded.layers[0].keys[3].shapes[1]).toMatchObject({ x: 72.5, y: 7.5 });
  expect(loaded.layers[0].motionSpans![0].rotation!.rigidPivot).toEqual({ x: 4, y: 3 });
  const before = clone(loaded);
  loaded.layers[0].keys[6].shapes.forEach((s) => (s.x += 20));
  refreshChangedBasicMotionSpans(before, loaded);
  expect(loaded.layers[0].keys[3].shapes[1]).toMatchObject({ x: 82.5, y: 7.5 });
  const old = migrateProject({ ...p, schemaVersion: 32 });
  expect(old.layers[0].motionSpans![0].rotation).toBeUndefined();
  expect(old.layers[0].motionSpans![0].options).toEqual({ affine: true });
});
it('retains extra rotation turns and rejects malformed rotation recipes atomically', () => {
  const p = fixture(),
    ids = [p.layers[0].id];
  const before = structuredClone(p);
  expect(() =>
    createBasicMotionSpan(p, ids, 0, 4, 'linear', undefined, undefined, {
      direction: 'shortest',
      turns: 1,
    }),
  ).toThrow();
  expect(p).toEqual(before);
  createBasicMotionSpan(p, ids, 0, 4, 'linear', undefined, undefined, {
    direction: 'clockwise',
    turns: 1,
  });
  expect(p.layers[0].keys[2].shapes[0].rotation).toBe(180);
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded, ids, 0, 4);
  expect(loaded.layers[0].keys[2].shapes[0].rotation).toBe(180);
  loaded.layers[0].motionSpans![0].rotation!.rigidPivot = { x: Infinity, y: 0 };
  expect(() => validateProject(loaded)).toThrow();
});

it('retains a detached custom cubic through reload, automatic refresh and retiming', () => {
  const p = fixture(),
    ids = [p.layers[0].id];
  // X(u)=u and Y(u)=u^3, so halfway progress is exactly 1/8.
  const ease = { kind: 'cubic' as const, x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 0 };
  createBasicMotionSpan(p, ids, 0, 4, ease);
  expect(p.layers[0].keys[2].shapes[0].x).toBeCloseTo(10, 10);
  ease.y1 = 1;
  const loaded = migrateProject(JSON.parse(JSON.stringify(p))),
    before = clone(loaded);
  loaded.layers[0].keys[4].shapes[0].x = 160;
  refreshChangedBasicMotionSpans(before, loaded);
  expect(loaded.layers[0].keys[2].shapes[0].x).toBeCloseTo(20, 10);
  retimeBasicMotionSpan(loaded, ids, 0, 4, 7);
  expect(loaded.layers[0].keys[3].shapes[0].x).toBeCloseTo(20, 10);
  expect(loaded.layers[0].motionSpans![0].ease).toEqual({ ...ease, y1: 0 });
  expect(() => migrateProject({ ...p, schemaVersion: 33 })).toThrow('legacy motion easing');
});
it('rejects malformed custom curves and preserves every track on later recipe failure', () => {
  const p = fixture(),
    ids = [p.layers[0].id],
    before = clone(p);
  for (const bad of [NaN, Infinity, -0.1, 1.1]) {
    expect(() =>
      createBasicMotionSpan(p, ids, 0, 4, { kind: 'cubic', x1: bad, y1: 0, x2: 1, y2: 1 }),
    ).toThrow();
    expect(p).toEqual(before);
  }
  p.layers.push({ ...clone(p.layers[0]), id: 'later' });
  createBasicMotionSpan(
    p,
    p.layers.map((l) => l.id),
    0,
    4,
    { kind: 'cubic', x1: 0.25, y1: 0, x2: 0.75, y2: 1 },
  );
  p.layers[0].keys[4].shapes[0].x = 160;
  (p.layers[1].motionSpans![0].ease as { y1: number }).y1 = Infinity;
  const invalid = structuredClone(p);
  expect(() =>
    refreshBasicMotionSpan(
      p,
      p.layers.map((l) => l.id),
      0,
      4,
    ),
  ).toThrow();
  expect(p).toEqual(invalid);
  expect(() => validateProject(p)).toThrow();
});

it('persists per-span refresh selection without enabling other recipes', () => {
  const p = fixture();
  p.layers.push({ ...clone(p.layers[0]), id: 'manual' });
  createBasicMotionSpan(
    p,
    p.layers.map((l) => l.id),
    0,
    4,
    'linear',
  );
  setBasicMotionSpanAutoRefresh(p, [p.layers[0].id], 0, 4, true);
  const loaded = migrateProject(JSON.parse(JSON.stringify(p))),
    before = clone(loaded);
  for (const l of loaded.layers) l.keys[4].shapes[0].x = 160;
  refreshChangedBasicMotionSpans(before, loaded, true);
  expect(loaded.layers.map((l) => l.keys[2].shapes[0].x)).toEqual([80, 40]);
  setBasicMotionSpanAutoRefresh(loaded, [loaded.layers[0].id], 0, 4, false);
  const paused = clone(loaded);
  loaded.layers[0].keys[4].shapes[0].x = 240;
  refreshChangedBasicMotionSpans(paused, loaded, true);
  expect(loaded.layers[0].keys[2].shapes[0].x).toBe(80);
  const old = migrateProject({ ...p, schemaVersion: 34 });
  expect(old.layers[0].motionSpans![0].autoRefresh).toBeUndefined();
  expect(old.layers[0].keys).toEqual(p.layers[0].keys);
});
it('prepares saved refresh settings atomically and rejects malformed persisted flags', () => {
  const p = fixture();
  p.layers.push({ ...clone(p.layers[0]), id: 'later' });
  const ids = p.layers.map((l) => l.id);
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  p.layers[1].locked = true;
  const before = clone(p);
  expect(() => setBasicMotionSpanAutoRefresh(p, ids, 0, 4, true)).toThrow();
  expect(p).toEqual(before);
  expect(() => setBasicMotionSpanAutoRefresh(p, [ids[0]], 0, 4, null as never)).toThrow();
  p.layers[0].motionSpans![0].autoRefresh = 1 as never;
  expect(() => validateProject(p)).toThrow();
});

it.each([
  {
    guard: 'contourAreas',
    closed: true,
    from: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ],
    to: [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    ],
  },
  {
    guard: 'contourEdges',
    from: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    to: [
      { x: 0, y: 0 },
      { x: -10, y: 0 },
    ],
  },
  {
    guard: 'contourContacts',
    from: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: -1 },
      { x: 20, y: 1 },
    ],
    to: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: -100, y: -1 },
      { x: -100, y: 1 },
    ],
  },
  {
    guard: 'curveTangents',
    from: [
      { x: 0, y: 0, out: { x: 1, y: 1 } },
      { x: 3, y: 3, in: { x: 2, y: 2 } },
    ],
    to: [
      { x: 0, y: 0, out: { x: 1, y: -3 } },
      { x: -5, y: -9, in: { x: -6, y: -6 } },
    ],
  },
  {
    guard: 'curveSelfContacts',
    from: [
      { x: 0, y: 0, out: { x: 11 / 48, y: 0 } },
      { x: 3 / 16, y: 1, in: { x: -1 / 24, y: 1 / 3 } },
    ],
    to: [
      { x: 0, y: 0, out: { x: 11 / 48, y: -2 / 3 } },
      { x: 3 / 16, y: -1, in: { x: -1 / 24, y: -1 } },
    ],
  },
])(
  'reuses stored $guard after reopen for refresh, auto refresh and retiming',
  ({ guard, from, to, closed }) => {
    const p = fixture(),
      ids = [p.layers[0].id];
    for (const key of p.layers[0].keys)
      key.shapes = [
        {
          ...key.shapes[0],
          kind: 'bezier',
          nodes: clone(from),
          ...(closed ? { closed: true } : {}),
        },
      ];
    createBasicMotionSpan(p, ids, 0, 4, 'linear', { nodes: true, [guard]: true });
    const loaded = migrateProject(JSON.parse(JSON.stringify(p))),
      safe = clone(loaded);
    loaded.layers[0].keys[4].shapes[0].nodes = clone(to);
    const changed = clone(loaded);
    expect(() => refreshBasicMotionSpan(loaded, ids, 0, 4)).toThrow();
    expect(() => retimeBasicMotionSpan(loaded, ids, 0, 4, 7)).toThrow();
    expect(() => refreshChangedBasicMotionSpans(safe, loaded)).toThrow();
    expect(loaded).toEqual(changed);
    expect(() => migrateProject({ ...p, schemaVersion: 35 })).toThrow('motion span options');
  },
);
it('retains gradient resampling and opacity weighting through reopen, refresh and retime', () => {
  const p = fixture(),
    ids = [p.layers[0].id];
  for (const key of p.layers[0].keys)
    key.shapes[0].gradient = {
      kind: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 20, y: 0 },
      stops: key.frame
        ? [
            { offset: 0, color: '#0000ff', opacity: 1 },
            { offset: 0.5, color: '#0000ff', opacity: 1 },
            { offset: 1, color: '#0000ff', opacity: 1 },
          ]
        : [
            { offset: 0, color: '#ff0000', opacity: 0 },
            { offset: 1, color: '#ff0000', opacity: 0 },
          ],
    };
  const endpoints = clone(p.layers[0].keys);
  const options = { paint: true, gradientStops: true, gradientPremultiplied: true };
  createBasicMotionSpan(p, ids, 0, 4, 'linear', options);
  options.gradientPremultiplied = false;
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  const check = (frame: number) => {
    const stops = loaded.layers[0].keys.find((k) => k.frame === frame)!.shapes[0].gradient!.stops;
    expect(stops).toHaveLength(3);
    expect(stops.map((s) => s.color)).toEqual(['#0000ff', '#0000ff', '#0000ff']);
    expect(stops.map((s) => s.opacity)).toEqual([0.5, 0.5, 0.5]);
  };
  check(2);
  refreshBasicMotionSpan(loaded, ids, 0, 4);
  check(2);
  const before = clone(loaded);
  loaded.layers[0].keys[4].shapes[0].x = 160;
  refreshChangedBasicMotionSpans(before, loaded);
  check(2);
  retimeBasicMotionSpan(loaded, ids, 0, 4, 7);
  check(3);
  expect(loaded.layers[0].keys[0]).toEqual(endpoints[0]);
  expect(loaded.layers[0].keys[6].shapes[0].gradient).toEqual(endpoints[1].shapes[0].gradient);
  expect(() => migrateProject({ ...p, schemaVersion: 36 })).toThrow('motion span options');
});

it.each(['gradientStops', 'gradientPremultiplied'] as const)(
  'requires paint before saving %s without changing tracks',
  (flag) => {
    const p = fixture(),
      before = clone(p);
    expect(() =>
      createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear', { [flag]: true }),
    ).toThrow();
    expect(p).toEqual(before);
  },
);
it.each(['ordered', 'explicit', 'auto'] as const)(
  'persists %s gradient group correspondence and rejects stale mappings atomically',
  (mode) => {
    const p = fixture(),
      ids = [p.layers[0].id];
    for (const key of p.layers[0].keys)
      key.shapes[0].gradient = {
        kind: 'linear',
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 },
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: key.frame ? 0.8 : 0.2, color: '#00ff00' },
          { offset: 1, color: '#0000ff' },
        ],
      };
    const matching =
      mode === 'ordered'
        ? 'ordered'
        : {
            pairs:
              mode === 'auto'
                ? ('auto' as const)
                : ([
                    [0, 0],
                    [1, 1],
                    [2, 2],
                  ] as [number, number][]),
          };
    const endpoints = clone(p.layers[0].keys);
    createBasicMotionSpan(p, ids, 0, 4, 'linear', {
      paint: true,
      gradientGeometry: true,
      gradientStops: matching,
    });
    if (typeof matching === 'object' && Array.isArray(matching.pairs)) matching.pairs[1][1] = 0;
    const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
    const check = (frame: number) =>
      expect(
        loaded.layers[0].keys
          .find((k) => k.frame === frame)!
          .shapes[0].gradient!.stops.map((s) => s.offset),
      ).toEqual([0, 0.5, 1]);
    check(2);
    refreshBasicMotionSpan(loaded, ids, 0, 4);
    check(2);
    const before = clone(loaded);
    loaded.layers[0].keys[4].shapes[0].x += 80;
    refreshChangedBasicMotionSpans(before, loaded);
    check(2);
    retimeBasicMotionSpan(loaded, ids, 0, 4, 7);
    check(3);
    expect(loaded.layers[0].keys[0]).toEqual(endpoints[0]);
    expect(loaded.layers[0].keys[6].shapes[0].gradient).toEqual(endpoints[1].shapes[0].gradient);
    expect(() => migrateProject({ ...p, schemaVersion: 37 })).toThrow('motion span options');
    if (mode !== 'auto') {
      loaded.layers[0].keys[6].shapes[0].gradient!.stops.splice(1, 1);
      const changed = clone(loaded);
      expect(() => refreshBasicMotionSpan(loaded, ids, 0, 6)).toThrow();
      expect(loaded).toEqual(changed);
    }
  },
);

it('rejects malformed gradient recipe metadata before writes', () => {
  for (const matching of [
    null,
    [],
    'unknown',
    { pairs: [] },
    { pairs: Array(1) },
    { pairs: [Array(2)] },
    {
      pairs: [
        [0, 0],
        [2, 1],
      ],
    },
    {
      pairs: [
        [0, 0],
        [1, 1],
      ],
      extra: true,
    },
    {
      pairs: [
        [0, 0],
        [1, NaN],
      ],
    },
  ]) {
    const p = fixture(),
      before = clone(p);
    expect(() =>
      createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear', {
        paint: true,
        gradientStops: matching as never,
      }),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('stores compound contour order, starts and directions for refresh and retiming', () => {
  const p = fixture(),
    ids = [p.layers[0].id];
  const rings = [
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 20 },
    ],
    [
      { x: 30, y: 0 },
      { x: 40, y: 0 },
      { x: 30, y: 10 },
    ],
  ];
  for (const key of p.layers[0].keys)
    Object.assign(key.shapes[0], {
      kind: 'polygon',
      contours: key.frame ? [rings[1], rings[0]].map((r) => [r[1], r[0], r[2]]) : clone(rings),
    });
  const endpoints = clone(p.layers[0].keys),
    correspondence = { order: [1, 0], start: [1, 1], reverse: [true, true] };
  createBasicMotionSpan(
    p,
    ids,
    0,
    4,
    'linear',
    { nodes: true },
    undefined,
    undefined,
    correspondence,
  );
  correspondence.order.reverse();
  correspondence.start[0] = 0;
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  const check = (frame: number) =>
    expect(loaded.layers[0].keys.find((k) => k.frame === frame)!.shapes[0].contours).toEqual(rings);
  check(2);
  refreshBasicMotionSpan(loaded, ids, 0, 4);
  check(2);
  const before = clone(loaded);
  loaded.layers[0].keys[4].shapes[0].x += 80;
  refreshChangedBasicMotionSpans(before, loaded);
  check(2);
  retimeBasicMotionSpan(loaded, ids, 0, 4, 7);
  check(3);
  expect(loaded.layers[0].keys[0]).toEqual(endpoints[0]);
  expect(loaded.layers[0].keys[6].shapes[0].contours).toEqual(endpoints[1].shapes[0].contours);
  const old = migrateProject({ ...p, schemaVersion: 38 });
  expect(old.layers[0].motionSpans![0].correspondence).toBeUndefined();
  expect(old.layers[0].keys).toEqual(p.layers[0].keys);
  loaded.layers[0].keys[6].shapes[0].contours!.pop();
  const changed = clone(loaded);
  expect(() => refreshBasicMotionSpan(loaded, ids, 0, 6)).toThrow();
  expect(loaded).toEqual(changed);
});
it('rejects malformed saved contour settings before changing artwork', () => {
  for (const correspondence of [
    null,
    [],
    { start: NaN },
    { start: Array(2) },
    { reverse: [1] },
    { order: [0, 0] },
    { order: [1] },
    { unknown: true },
  ]) {
    const p = fixture(),
      before = clone(p);
    expect(() =>
      createBasicMotionSpan(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        { nodes: true },
        undefined,
        undefined,
        correspondence as never,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});

for (const mode of ['straight', 'hinted', 'curved', 'distance'] as const) {
  it(`persists ${mode} node matching through reopen, refresh, auto refresh and retiming`, () => {
    const p = fixture();
    const a = p.layers[0].keys[0].shapes[0];
    a.kind = 'bezier';
    a.nodes = [
      { x: 0, y: 0 },
      { x: 30, y: 20 },
      { x: 100, y: 0 },
    ];
    const b = clone(a);
    b.nodes = [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 60, y: 40 },
      { x: 100, y: 0 },
    ];
    const curved = mode === 'curved' || mode === 'distance';
    if (curved) {
      a.nodes[0].out = { x: 10, y: 40 };
      b.nodes[0].out = { x: 5, y: 20 };
    }
    p.layers[0].keys[1].shapes = [b];
    const endpoints = clone(p.layers[0].keys);
    const nodes =
      mode === 'straight'
        ? true
        : {
            hints: [[[1, 2] as [number, number]]],
            ...(curved ? { curves: true } : {}),
            ...(mode === 'distance' ? { distance: true } : {}),
          };
    const correspondence = { nodes };
    const ids = [p.layers[0].id];
    createBasicMotionSpan(
      p,
      ids,
      0,
      4,
      'linear',
      { nodes: true },
      undefined,
      undefined,
      correspondence,
    );
    const expected = clone(p.layers[0].keys[2].shapes[0].nodes);
    expect(expected!.length).toBeGreaterThanOrEqual(4);
    if (typeof nodes !== 'boolean') nodes.hints[0][0][1] = 1;
    const reopened = migrateProject(JSON.parse(JSON.stringify(p)));
    refreshBasicMotionSpan(reopened, ids, 0, 4);
    expect(reopened.layers[0].keys[2].shapes[0].nodes).toEqual(expected);
    expect(reopened.layers[0].keys[0]).toEqual(endpoints[0]);
    expect(reopened.layers[0].keys[4]).toEqual(endpoints[1]);
    setBasicMotionSpanAutoRefresh(reopened, ids, 0, 4, true);
    const before = clone(reopened);
    reopened.layers[0].keys[4].shapes[0].x += 20;
    refreshChangedBasicMotionSpans(before, reopened, true);
    expect(reopened.layers[0].keys[2].shapes[0].nodes).toEqual(expected);
    retimeBasicMotionSpan(reopened, ids, 0, 4, 7);
    expect(reopened.layers[0].keys[3].shapes[0].nodes).toEqual(expected);
    if (mode !== 'straight') {
      reopened.layers[0].keys[6].shapes[0].nodes = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ];
      const unchanged = clone(reopened);
      expect(() => refreshBasicMotionSpan(reopened, ids, 0, 6)).toThrow();
      expect(reopened).toEqual(unchanged);
    }
  });
}
it('rejects malformed saved node matching and preserves schema 39 alignment semantics', () => {
  for (const nodes of [
    null,
    {},
    { distance: true },
    { curves: 1 },
    { hints: Array(1) },
    { hints: [[Array(2)]] },
    {
      hints: [
        [
          [1, 1],
          [1, 2],
        ],
      ],
    },
    { hints: [[[0, 1]]] },
  ]) {
    const p = fixture(),
      before = clone(p);
    expect(() =>
      createBasicMotionSpan(
        p,
        [p.layers[0].id],
        0,
        4,
        'linear',
        { nodes: true },
        undefined,
        undefined,
        { nodes } as never,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
  const p = fixture();
  createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear');
  p.layers[0].motionSpans![0].correspondence = { start: 0 };
  expect(migrateProject({ ...p, schemaVersion: 39 })).toEqual(p);
  p.layers[0].motionSpans![0].correspondence.nodes = true;
  expect(() => migrateProject({ ...p, schemaVersion: 39 })).toThrow(/schema 39/);
});

it('moves a whole saved recipe into blank time and can refresh after moving back', () => {
  const p = fixture();
  p.duration = 14;
  p.layers[0].keys.push({ frame: 5, shapes: [] }, { frame: 13, shapes: [] });
  const ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 0, 4, 'in');
  setBasicMotionSpanAutoRefresh(p, ids, 0, 4, true);
  const original = clone(p.layers[0]);
  moveBasicMotionSpan(p, ids, 0, 4, 7);
  expect(p.duration).toBe(14);
  expect(p.layers[0].motionSpans![0]).toMatchObject({
    id: original.motionSpans![0].id,
    start: 7,
    end: 11,
    autoRefresh: true,
    ease: 'in',
  });
  expect(
    p.layers[0].keys
      .filter((k) => k.frame >= 7 && k.frame <= 11)
      .map((k) => ({ ...k, frame: k.frame - 7 })),
  ).toEqual(original.keys.slice(0, 5));
  expect(p.layers[0].keys[0]).toEqual({ frame: 0, shapes: [] });
  expect(p.layers[0].keys.find((k) => k.frame === 13)).toEqual(original.keys.at(-1));
  const reopened = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(reopened, ids, 7, 11);
  moveBasicMotionSpan(reopened, ids, 7, 11, 0);
  refreshBasicMotionSpan(reopened, ids, 0, 4);
  expect(reopened.layers[0].keys.slice(0, 5)).toEqual(original.keys.slice(0, 5));
});
it('moves overlapping spans without changing endpoint holds outside either range', () => {
  const p = fixture();
  p.duration = 12;
  p.layers[0].keys = p.layers[0].keys.map((k) => ({ ...k, frame: k.frame + 3 }));
  p.layers[0].keys.unshift({ frame: 0, shapes: [] });
  const ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 3, 7, 'linear');
  const target = clone(p.layers[0].keys.find((k) => k.frame === 7)!.shapes);
  moveBasicMotionSpan(p, ids, 3, 7, 1);
  expect(p.layers[0].keys.find((k) => k.frame === 5)!.shapes).toEqual(target);
  expect(p.layers[0].keys.find((k) => k.frame === 6)!.shapes).toEqual([]);
  expect(p.layers[0].keys.find((k) => k.frame === 8)!.shapes).toEqual(target);
  refreshBasicMotionSpan(p, ids, 1, 5);
});
it('rejects occupied destinations, shared endpoints, edits, bounds and protected batches atomically', () => {
  for (const mode of ['occupied', 'shared', 'edited', 'bounds', 'locked', 'invalid'] as const) {
    const p = fixture();
    p.duration = 14;
    p.layers[0].keys.push({ frame: 5, shapes: [] });
    const ids = [p.layers[0].id];
    createBasicMotionSpan(p, ids, 0, 4, 'linear');
    if (mode === 'occupied')
      p.layers[0].keys.push({ frame: 8, shapes: clone(p.layers[0].keys[0].shapes) });
    if (mode === 'shared')
      p.layers[0].motionSpans!.push({
        ...clone(p.layers[0].motionSpans![0]),
        id: 'shared',
        start: 4,
        end: 6,
      });
    if (mode === 'edited') p.layers[0].keys[2].shapes[0].x++;
    if (mode === 'invalid') p.layers[0].keys[4].shapes[0].x = NaN;
    if (mode === 'locked') {
      const l = clone(p.layers[0]);
      l.id = 'locked';
      l.locked = true;
      p.layers.push(l);
      ids.push(l.id);
    }
    const before = structuredClone(p);
    expect(() => moveBasicMotionSpan(p, ids, 0, 4, mode === 'bounds' ? 11 : 7)).toThrow();
    expect(p).toEqual(before);
  }
});
it('moves symbol base and additional recipes atomically, including a recipe at the first frame', () => {
  const p = fixture();
  const keys = [
    { frame: 0, shapes: clone(p.layers[0].keys[0].shapes) },
    ...p.layers[0].keys.map((k) => ({ ...clone(k), frame: k.frame + 2 })),
    { frame: 7, shapes: [] },
  ];
  const def = {
    id: 'move',
    name: 'Move',
    width: 100,
    height: 100,
    shapes: keys[0].shapes,
    timeline: {
      duration: 16,
      keys: keys.slice(1),
      layers: [{ id: 'extra', name: 'Extra', visible: true, locked: false, keys: clone(keys) }],
    },
  };
  const created = editSymbolBasicMotionSpan(def, ['@base', 'extra'], 2, 6, 'create');
  const before = clone(created);
  const moved = editSymbolBasicMotionSpan(
    created,
    ['@base', 'extra'],
    2,
    6,
    'move',
    'linear',
    [created],
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    9,
  );
  expect(created).toEqual(before);
  expect(moved.shapes).toEqual(def.shapes);
  expect(moved.timeline!.motionSpans![0]).toMatchObject({ start: 9, end: 13 });
  expect(moved.timeline!.layers![0].motionSpans![0]).toMatchObject({ start: 9, end: 13 });
  expect(editSymbolBasicMotionSpan(moved, ['@base', 'extra'], 9, 13, 'refresh')).toEqual(moved);
  const initial = editSymbolBasicMotionSpan(
    {
      ...def,
      timeline: {
        duration: 16,
        keys: [
          { frame: 4, shapes: clone(def.shapes) },
          { frame: 5, shapes: [] },
        ],
      },
    },
    ['@base'],
    0,
    4,
    'create',
  );
  const movedInitial = editSymbolBasicMotionSpan(
      initial,
      ['@base'],
      0,
      4,
      'move',
      'linear',
      [initial],
      undefined,
      false,
      undefined,
      undefined,
      undefined,
      false,
      undefined,
      8,
    );
  expect(movedInitial.shapes).toEqual([]);
  expect(movedInitial.timeline!.motionSpans![0]).toMatchObject({ start: 8, end: 12 });
  expect(movedInitial.timeline!.keys.find(key => key.frame === 8)?.shapes).toEqual(initial.shapes);
});

it('moves connected recipes together with shared keys and distinct refresh policies', () => {
  const p = fixture();
  p.duration = 24;
  const target = clone(p.layers[0].keys[1].shapes);
  p.layers[0].keys.push(
    { frame: 8, shapes: target.map((s) => ({ ...s, x: 160 })) },
    { frame: 9, shapes: [] },
  );
  const ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  createBasicMotionSpan(p, ids, 4, 8, 'in');
  setBasicMotionSpanAutoRefresh(p, ids, 4, 8, true);
  const before = clone(p.layers[0]);
  moveBasicMotionSpan(p, ids, 0, 8, 12);
  expect(
    p.layers[0].motionSpans!.map((s) => [s.id, s.start, s.end, s.ease, s.autoRefresh]),
  ).toEqual(
    before.motionSpans!.map((s) => [s.id, s.start + 12, s.end + 12, s.ease, s.autoRefresh]),
  );
  expect(
    p.layers[0].keys
      .filter((k) => k.frame >= 12 && k.frame <= 20)
      .map((k) => ({ ...k, frame: k.frame - 12 })),
  ).toEqual(before.keys.slice(0, 9));
  const reopened = migrateProject(JSON.parse(JSON.stringify(p)));
  const prior = clone(reopened);
  reopened.layers[0].keys.find((k) => k.frame === 20)!.shapes[0].x = 240;
  refreshChangedBasicMotionSpans(prior, reopened, true);
  expect(reopened.layers[0].keys.find((k) => k.frame === 18)!.shapes[0].x).toBe(120);
  refreshBasicMotionSpan(reopened, ids, 12, 16);
  expect(reopened.layers[0].keys.find((k) => k.frame === 14)!.shapes[0].x).toBe(40);
});
it('rejects partial, disconnected and later-conflicting chains without changing any selected track', () => {
  for (const mode of ['partial', 'gap', 'edited', 'endpoint', 'destination'] as const) {
    const p = fixture();
    p.duration = 24;
    p.layers[0].keys.push(
      { frame: 8, shapes: clone(p.layers[0].keys[1].shapes) },
      { frame: 9, shapes: [] },
    );
    const ids = [p.layers[0].id];
    createBasicMotionSpan(p, ids, 0, 4, 'linear');
    createBasicMotionSpan(p, ids, 4, 8, 'in');
    const later = clone(p.layers[0]);
    later.id = 'later';
    p.layers.push(later);
    ids.push(later.id);
    if (mode === 'gap') later.motionSpans![1].start = 5;
    if (mode === 'edited') later.keys[6].shapes[0].x++;
    if (mode === 'endpoint') later.keys[8].shapes[0].x = Infinity;
    if (mode === 'destination')
      later.motionSpans!.push({
        ...clone(later.motionSpans![0]),
        id: 'outside',
        start: 20,
        end: 22,
      });
    const before = structuredClone(p);
    expect(() => moveBasicMotionSpan(p, ids, 0, mode === 'partial' ? 6 : 8, 12)).toThrow();
    expect(p).toEqual(before);
  }
});

it('transfers a connected recipe chain across tracks while preserving IDs, outside exposures and refresh', () => {
  const p = fixture();
  p.duration = 24;
  p.layers[0].keys.push(
    { frame: 8, shapes: clone(p.layers[0].keys[1].shapes) },
    { frame: 9, shapes: [] },
  );
  const source = p.layers[0],
    ids = [source.id];
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  createBasicMotionSpan(p, ids, 4, 8, 'in');
  setBasicMotionSpanAutoRefresh(p, ids, 4, 8, true);
  const original = clone(source);
  const target: typeof source = {
    ...clone(source),
    id: 'target',
    keys: [{ frame: 0, shapes: [] }],
    motionSpans: undefined,
  };
  p.layers.push(target);
  moveBasicMotionSpan(p, ids, 0, 8, 12, target.id);
  expect(source.motionSpans).toBeUndefined();
  expect(source.keys[0].shapes).toEqual([]);
  expect(
    target.keys
      .filter((k) => k.frame >= 12 && k.frame <= 20)
      .map((k) => ({ ...k, frame: k.frame - 12 })),
  ).toEqual(original.keys.slice(0, 9));
  expect(target.motionSpans!.map((s) => [s.id, s.ease, s.autoRefresh])).toEqual(
    original.motionSpans!.map((s) => [s.id, s.ease, s.autoRefresh]),
  );
  const reopened = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(reopened, [target.id], 12, 16);
  expect(reopened).toEqual(p);
});
it('rejects cross-track collisions, protection, identity reuse and incompatible modes atomically', () => {
  for (const mode of [
    'occupied',
    'recipe',
    'identity',
    'group',
    'locked',
    'hidden',
    'mode',
    'batch',
  ] as const) {
    const p = fixture();
    p.duration = 16;
    p.layers[0].keys[0].shapes[0].groups = ['group'];
    p.layers[0].keys[1].shapes[0].groups = ['group'];
    createBasicMotionSpan(p, [p.layers[0].id], 0, 4, 'linear');
    const target = clone(p.layers[0]);
    target.id = 'target';
    target.keys = [{ frame: 0, shapes: [] }];
    delete target.motionSpans;
    if (mode === 'occupied')
      target.keys.push({ frame: 9, shapes: clone(p.layers[0].keys[0].shapes) });
    if (mode === 'identity' || mode === 'group') {
      const shape = clone(p.layers[0].keys[0].shapes[0]);
      if (mode === 'group') shape.id = 'other';
      target.keys[0].shapes = [shape];
      target.keys.push({ frame: 1, shapes: [] });
    }
    if (mode === 'recipe')
      target.motionSpans = [
        { ...clone(p.layers[0].motionSpans![0]), id: 'other', start: 12, end: 14 },
      ];
    if (mode === 'locked') target.locked = true;
    if (mode === 'hidden') target.visible = false;
    if (mode === 'mode') target.drawingMode = 'merge';
    p.layers.push(target);
    const before = clone(p);
    expect(() =>
      moveBasicMotionSpan(
        p,
        mode === 'batch' ? p.layers.map((l) => l.id) : [p.layers[0].id],
        0,
        4,
        8,
        target.id,
      ),
    ).toThrow();
    expect(p).toEqual(before);
  }
});
it('transfers symbol recipes from base to an additional track in one detached transaction', () => {
  const p = fixture();
  const shape = clone(p.layers[0].keys[0].shapes);
  const def = {
    id: 'cross',
    name: 'Cross',
    width: 100,
    height: 100,
    shapes: shape,
    timeline: {
      duration: 16,
      keys: [
        { frame: 2, shapes: shape },
        { frame: 6, shapes: clone(p.layers[0].keys[1].shapes) },
        { frame: 7, shapes: [] },
      ],
      layers: [
        {
          id: 'target',
          name: 'Target',
          visible: true,
          locked: false,
          keys: [{ frame: 0, shapes: [] }],
        },
      ],
    },
  };
  const created = editSymbolBasicMotionSpan(def, ['@base'], 2, 6, 'create');
  const before = clone(created);
  const moved = editSymbolBasicMotionSpan(
    created,
    ['@base'],
    2,
    6,
    'move',
    'linear',
    [created],
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    9,
    'target',
  );
  expect(created).toEqual(before);
  expect(moved.shapes).toEqual(def.shapes);
  expect(moved.timeline!.motionSpans).toBeUndefined();
  expect(moved.timeline!.layers![0].motionSpans![0]).toMatchObject({
    id: created.timeline!.motionSpans![0].id,
    start: 9,
    end: 13,
  });
  expect(editSymbolBasicMotionSpan(moved, ['target'], 9, 13, 'refresh')).toEqual(moved);
});

it('retimes connected recipes proportionally while retaining shared artwork and separate easing', () => {
  const p = fixture();
  p.duration = 24;
  p.layers[0].keys.push(
    { frame: 8, shapes: [{ ...clone(p.layers[0].keys[1].shapes[0]), x: 160 }] },
    { frame: 20, shapes: [] },
  );
  const ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  createBasicMotionSpan(p, ids, 4, 8, 'in');
  const original = clone(p.layers[0]);
  retimeBasicMotionSpan(p, ids, 0, 8, 13);
  expect(p.layers[0].motionSpans!.map((s) => [s.id, s.start, s.end, s.ease])).toEqual(
    original.motionSpans!.map((s, i) => [s.id, i * 6, (i + 1) * 6, s.ease]),
  );
  expect(p.layers[0].keys.find((k) => k.frame === 6)!.shapes).toEqual(original.keys[4].shapes);
  expect(p.layers[0].keys.find((k) => k.frame === 12)!.shapes).toEqual(original.keys[8].shapes);
  expect(p.layers[0].keys.find((k) => k.frame === 3)!.shapes[0].x).toBe(40);
  expect(p.layers[0].keys.find((k) => k.frame === 9)!.shapes[0].x).toBe(100);
  expect(p.layers[0].keys.at(-1)).toEqual(original.keys.at(-1));
  const reopened = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(reopened, ids, 0, 6);
  refreshBasicMotionSpan(reopened, ids, 6, 12);
  retimeBasicMotionSpan(reopened, ids, 0, 12, 5);
  expect(reopened.layers[0].motionSpans!.map((s) => [s.start, s.end])).toEqual([
    [0, 2],
    [2, 4],
  ]);
});
it('rejects collapsed chain segments and later recipe failures atomically and ripples following recipes', () => {
  const p = fixture();
  p.duration = 24;
  p.layers[0].keys.push(
    { frame: 8, shapes: clone(p.layers[0].keys[1].shapes) },
    { frame: 12, shapes: clone(p.layers[0].keys[1].shapes) },
  );
  const ids = [p.layers[0].id];
  for (const start of [0, 4, 8]) createBasicMotionSpan(p, ids, start, start + 4, 'linear');
  for (const length of [3, 4]) {
    const before = clone(p);
    expect(() => retimeBasicMotionSpan(p, ids, 0, 8, length, true)).toThrow(/three frames/);
    expect(p).toEqual(before);
  }
  const outside = clone(p.layers[0].keys.filter((k) => k.frame >= 8));
  retimeBasicMotionSpan(p, ids, 0, 8, 13, true);
  expect(p.layers[0].motionSpans!.map((s) => [s.start, s.end])).toEqual([
    [0, 6],
    [6, 12],
    [12, 16],
  ]);
  expect(
    p.layers[0].keys.filter((k) => k.frame >= 12).map((k) => ({ ...k, frame: k.frame - 4 })),
  ).toEqual(outside);
  p.layers[0].keys.find((k) => k.frame === 12)!.shapes[0].x = Infinity;
  const before = structuredClone(p);
  expect(() => retimeBasicMotionSpan(p, ids, 0, 12, 9, true)).toThrow();
  expect(p).toEqual(before);
});

it('rounds unequal chain boundaries proportionally and keeps shared endpoints exact', () => {
  const p = fixture();
  p.duration = 20;
  p.layers[0].keys[1].frame = 3;
  const shared = clone(p.layers[0].keys[1].shapes);
  p.layers[0].keys.push({ frame: 8, shapes: shared.map((s) => ({ ...s, x: 160 })) });
  const ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 0, 3, 'linear');
  createBasicMotionSpan(p, ids, 3, 8, 'out');
  retimeBasicMotionSpan(p, ids, 0, 8, 13);
  expect(p.layers[0].motionSpans!.map((s) => [s.start, s.end])).toEqual([
    [0, 5],
    [5, 12],
  ]);
  expect(p.layers[0].keys.find((k) => k.frame === 5)!.shapes).toEqual(shared);
  const before = clone(p);
  expect(() => retimeBasicMotionSpan(p, ids, 0, 12, 4)).toThrow(/three frames/);
  expect(p).toEqual(before);
});

it('retimes chain segments independently using explicit inclusive counts and saved easing', () => {
  const p = fixture();
  p.duration = 24;
  p.layers[0].keys.push(
    { frame: 8, shapes: [{ ...clone(p.layers[0].keys[1].shapes[0]), x: 160 }] },
    { frame: 9, shapes: [] },
  );
  const ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  createBasicMotionSpan(p, ids, 4, 8, 'in');
  const endpoints = clone([p.layers[0].keys[0], p.layers[0].keys[4], p.layers[0].keys[8]]);
  retimeBasicMotionSpan(p, ids, 0, 8, 3, true, parseMotionSpanLengths('3, 9'));
  expect(p.layers[0].motionSpans!.map((s) => [s.start, s.end])).toEqual([
    [0, 2],
    [2, 10],
  ]);
  expect(p.layers[0].keys.find((k) => k.frame === 1)!.shapes[0].x).toBe(40);
  expect(p.layers[0].keys.find((k) => k.frame === 6)!.shapes[0].x).toBe(100);
  for (const [i, frame] of [0, 2, 10].entries())
    expect(p.layers[0].keys.find((k) => k.frame === frame)!.shapes).toEqual(endpoints[i].shapes);
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded, ids, 2, 10);
  expect(loaded).toEqual(p);
  for (const counts of [[3], [3, 3, 3], [2, 9], Array(2), [3, Infinity], [3, 100]]) {
    const before = clone(p);
    expect(() => retimeBasicMotionSpan(p, ids, 0, 10, 5, true, counts)).toThrow();
    expect(p).toEqual(before);
  }
  expect(parseMotionSpanLengths(' ')).toBeUndefined();
  for (const text of ['2,9', '3,', '3.5,9', '3,-9', '3;9'])
    expect(() => parseMotionSpanLengths(text)).toThrow();
});

it('reopens and refreshes straight heading recipes and rejects a stationary edited endpoint atomically', () => {
  const p = fixture(), ids = [p.layers[0].id];
  const path = { startX: 0, startY: 0, endX: 0, endY: 0, tangent: true,
    waypoints: [{ x: 30, y: 0 }, { x: 30, y: 40 }] };
  createBasicMotionSpan(p, ids, 0, 4, 'linear', undefined, path);
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded, ids, 0, 4);
  expect(loaded.layers[0].keys[2].shapes[0].rotation).toBe(90);
  retimeBasicMotionSpan(loaded, ids, 0, 4, 7);
  expect(loaded.layers[0].keys[2].shapes[0].rotation).toBe(90);
  const end = loaded.layers[0].keys.find(k => k.frame === 6)!.shapes[0];
  end.x = 30; end.y = 40;
  const before = clone(loaded);
  expect(() => refreshBasicMotionSpan(loaded, ids, 0, 6)).toThrow(/tangent/);
  expect(loaded).toEqual(before);
});

it('promotes an edited interior key and reapplies saved easing to independently refreshable halves', () => {
  const p = fixture(), ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 0, 4, 'in');
  const layer = p.layers[0], recipe = clone(layer.motionSpans![0]);
  layer.motionSpans![0].autoRefresh = true;
  layer.keys[2].shapes[0].x = 60;
  const endpoints = [clone(layer.keys[0]), clone(layer.keys[2]), clone(layer.keys[4])];
  splitBasicMotionSpan(p, ids, 0, 4, 2);
  expect(layer.motionSpans!.map(s => [s.start, s.end, s.ease, s.autoRefresh])).toEqual([[0, 2, 'in', true], [2, 4, 'in', true]]);
  expect(layer.motionSpans![0].id).toBe(recipe.id);
  expect(layer.motionSpans![1].id).not.toBe(recipe.id);
  expect(layer.keys.filter(k => k.frame % 2 === 0)).toEqual(endpoints);
  expect(layer.keys[1].shapes[0].x).toBe(15);
  expect(layer.keys[3].shapes[0].x).toBe(65);
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded, ids, 0, 2);
  refreshBasicMotionSpan(loaded, ids, 2, 4);
  expect(loaded.layers[0].keys).toEqual(layer.keys);
});
it('rejects incomplete halves, other interior edits and a conflicting later track without partial splits', () => {
  const p = fixture(), ids = [p.layers[0].id];
  createBasicMotionSpan(p, ids, 0, 4, 'linear');
  for (const at of [0, 1, 3, 4, 2.5, NaN]) {
    const before = clone(p);
    expect(() => splitBasicMotionSpan(p, ids, 0, 4, at)).toThrow(/three frames/);
    expect(p).toEqual(before);
  }
  const second = clone(p.layers[0]); second.id = 'second';
  p.layers.push(second); second.keys[1].shapes[0].x++;
  const before = clone(p);
  expect(() => splitBasicMotionSpan(p, [...ids, second.id], 0, 4, 2)).toThrow(/Only the split key/);
  expect(p).toEqual(before);
  second.keys[1].shapes[0].x--;
  second.keys[2].shapes[0].id = 'incompatible';
  const invalid = clone(p);
  expect(() => splitBasicMotionSpan(p, [...ids, second.id], 0, 4, 2)).toThrow();
  expect(p).toEqual(invalid);
});
it('splits symbol base and additional tracks in an isolated transaction with mappings intact', () => {
  const p = fixture(), layer = p.layers[0];
  const d = { id: 'split', name: 'Split', width: 100, height: 100,
    shapes: clone(layer.keys[0].shapes), buttonStates: { up: 0, over: 1, down: 2, hit: 3 },
    timeline: { duration: 8, keys: clone(layer.keys.slice(1)), layers: [{ ...clone(layer), id: 'extra' }] } };
  const created = editSymbolBasicMotionSpan(d, ['@base', 'extra'], 0, 4, 'create');
  const before = clone(created);
  const result = editSymbolBasicMotionSpan(created, ['@base', 'extra'], 0, 4, 'split', 'linear', [created], undefined, false, undefined, undefined, undefined, false, undefined, undefined, undefined, undefined, 2);
  expect(created).toEqual(before);
  expect(result.timeline!.motionSpans).toHaveLength(2);
  expect(result.timeline!.layers![0].motionSpans).toHaveLength(2);
  expect(result.buttonStates).toEqual(d.buttonStates);
  expect(result.timeline!.keys).toEqual(before.timeline!.keys);
});

it('restricts simple easing trajectories at arbitrary fractions with independent polynomial samples', () => {
  for (const ease of ['linear', 'in', 'out', 'in-out'] as const)
    for (const fraction of ease === 'in-out' ? [0.5] : [0.2, 0.5, 0.8]) {
      const [left, right] = splitSimpleMotionEase(ease, fraction);
      const value = (t: number) => ease === 'linear' ? t : ease === 'in' ? t * t : ease === 'out' ? 2 * t - t * t : t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2;
      const at = value(fraction);
      for (let i = 0; i <= 100; i++) {
        const t = i / 100;
        expect(at * motionProgress(t, left)).toBeCloseTo(value(fraction * t), 13);
        expect(at + (1 - at) * motionProgress(t, right)).toBeCloseTo(value(fraction + (1 - fraction) * t), 13);
      }
    }
});
it.each(['linear', 'in', 'out', 'in-out'] as const)('preserves existing simple %s keys and derives refreshable recipes', (ease) => {
  const p = fixture(), ids = [p.layers[0].id];
  p.layers[0].keys[0].shapes[0].rotation = 270;
  p.layers[0].keys[1].shapes[0].rotation = 0;
  p.layers[0].keys[0].shapes[0].opacity = 0.2;
  p.layers[0].keys[1].shapes[0].opacity = 0.8;
  createBasicMotionSpan(p, ids, 0, 4, ease);
  const before = clone(p.layers[0].keys);
  splitBasicMotionSpan(p, ids, 0, 4, 2, true);
  expect(p.layers[0].keys).toEqual(before);
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded, ids, 0, 2); refreshBasicMotionSpan(loaded, ids, 2, 4);
  for (let i = 0; i < before.length; i++)
    for (const field of ['x', 'y', 'rotation', 'opacity'] as const)
      expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field]!, 12);
});
it('rejects edited poses and unsupported preservation recipes without changing their keys or ownership', () => {
  for (const kind of ['interior', 'endpoint', 'path', 'cubic', 'property']) {
    const p = fixture(), ids = [p.layers[0].id];
    createBasicMotionSpan(p, ids, 0, 4, 'in');
    const span = p.layers[0].motionSpans![0];
    if (kind === 'interior') p.layers[0].keys[2].shapes[0].x++;
    if (kind === 'endpoint') p.layers[0].keys[4].shapes[0].x++;
    if (kind === 'path') span.path = { startX: 0, startY: 10, endX: 0, endY: 10 };
    if (kind === 'cubic') span.ease = { kind: 'cubic', x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 };
    if (kind === 'property') span.path = {startX:10,startY:20,endX:-10,endY:20,tangent:true};
    const before = clone(p);
    expect(() => splitBasicMotionSpan(p, ids, 0, 4, 2, true)).toThrow(/Preserved/);
    expect(p).toEqual(before);
  }
  expect(() => splitSimpleMotionEase('in-out', 0.25)).toThrow(/midpoint/);
});

it('reopens, refreshes and retimes a saved Y-shear group recipe', () => {
  const p = fixture(), ids = [p.layers[0].id];
  const [first, last] = p.layers[0].keys;
  first.shapes[0].groups = ['group'];
  first.shapes.push({ ...first.shapes[0], id: 'member', x: 20 });
  last.shapes = first.shapes.map(s => ({ ...s, x: s.x + 80, y: s.x * 0.75,
    transform: [1, 0.75, 0, 1] as [number, number, number, number] }));
  createBasicMotionSpan(p, ids, 0, 4, 'linear', { affine: true }, undefined,
    { direction: 'shortest', turns: 0, rigidGroups: true, axisGroupScale: true, axisGroupShear: true });
  const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded, ids, 0, 4);
  expect(loaded.layers[0].keys[2].shapes[1].y).toBe(7.5);
  retimeBasicMotionSpan(loaded, ids, 0, 4, 7);
  expect(loaded.layers[0].keys[3].shapes[1].y).toBe(7.5);
  expect(loaded.layers[0].motionSpans![0].rotation!.axisGroupShear).toBe(true);
});

it('restricts custom cubic easing using independent parametric curve samples', () => {
  const ease = { kind: 'cubic' as const, x1: 0.15, y1: 0.05, x2: 0.7, y2: 0.9 };
  const cubic = (u: number, a: number, b: number) => 3*(1-u)**2*u*a + 3*(1-u)*u*u*b + u**3;
  for (const u of [0.2, 0.5, 0.8]) {
    const f = cubic(u,ease.x1,ease.x2), progress = cubic(u,ease.y1,ease.y2);
    const [left,right] = splitSimpleMotionEase(ease,f);
    for (let i=0;i<=100;i++) {
      const v=i/100, x=cubic(v,ease.x1,ease.x2), y=cubic(v,ease.y1,ease.y2);
      const actual = x<=f ? progress*motionProgress(x/f,left) : progress+(1-progress)*motionProgress((x-f)/(1-f),right);
      expect(actual).toBeCloseTo(y,13);
    }
  }
  expect(() => splitSimpleMotionEase({kind:'cubic',x1:1/3,x2:2/3,y1:1,y2:0},0.75)).toThrow(/representable/);
});
it('preserves authored custom cubic keys through splitting and saved refresh', () => {
  const p=fixture(), ids=[p.layers[0].id];
  const ease={kind:'cubic' as const,x1:0.15,y1:0.05,x2:0.7,y2:0.9};
  createBasicMotionSpan(p,ids,0,4,ease);
  const keys=clone(p.layers[0].keys);
  splitBasicMotionSpan(p,ids,0,4,2,true);
  expect(p.layers[0].keys).toEqual(keys);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded,ids,0,2); refreshBasicMotionSpan(loaded,ids,2,4);
  for(let i=0;i<keys.length;i++) expect(loaded.layers[0].keys[i].shapes[0].x).toBeCloseTo(keys[i].shapes[0].x,12);
});
it('splits a derived cubic recipe again after refreshing its numerical samples', () => {
  const p=fixture(), ids=[p.layers[0].id];
  p.duration=9; p.layers[0].keys[1].frame=8;
  createBasicMotionSpan(p,ids,0,8,'in');
  splitBasicMotionSpan(p,ids,0,8,4,true);
  refreshBasicMotionSpan(p,ids,4,8);
  const keys=clone(p.layers[0].keys);
  splitBasicMotionSpan(p,ids,4,8,6,true);
  expect(p.layers[0].keys).toEqual(keys);
  expect(p.layers[0].motionSpans).toHaveLength(3);
});


it('reopens, refreshes and retimes group paths with saved pivots', () => {
  const p=fixture(), ids=[p.layers[0].id];
  const [first,last]=p.layers[0].keys;
  first.shapes[0].groups=['group']; first.shapes[0].pivot={x:10,y:6};
  first.shapes.push({...clone(first.shapes[0]),id:'member',x:20});
  last.shapes=first.shapes.map(s=>({...clone(s),x:s.x+80}));
  createBasicMotionSpan(p,ids,0,4,'linear',undefined,
    {startX:0,startY:-40,endX:0,endY:-40},
    {direction:'shortest',turns:0,rigidGroups:true,savedGroupPivots:true});
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded,ids,0,4);
  expect(loaded.layers[0].keys[2].shapes[0].x).toBe(40);
  expect(loaded.layers[0].keys[2].shapes[0].y).toBe(-30);
  retimeBasicMotionSpan(loaded,ids,0,4,7);
  expect(loaded.layers[0].keys[3].shapes[0].x).toBe(40);
  expect(loaded.layers[0].keys[3].shapes[0].y).toBe(-30);
});


it('reopens and retimes remembered simultaneous group shear with a custom pivot and path', () => {
  const p=fixture(), ids=[p.layers[0].id];
  const [first,last]=p.layers[0].keys;
  first.shapes[0].groups=['group'];
  first.shapes.push({...clone(first.shapes[0]),id:'member',x:20});
  last.shapes=first.shapes.map(s=>({...clone(s),x:s.x+80,y:0.75*s.x,transform:[1,0.75,0.25,1] as [number,number,number,number]}));
  createBasicMotionSpan(p,ids,0,4,'linear',{affine:true},
    {startX:0,startY:-40,endX:0,endY:-40},
    {direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true,rigidPivot:{x:10,y:6}});
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded,ids,0,4);
  expect(loaded.layers[0].keys[2].shapes[0].transform).toEqual([1,0.375,0.125,1]);
  retimeBasicMotionSpan(loaded,ids,0,4,7);
  expect(loaded.layers[0].keys[3].shapes[0].transform).toEqual([1,0.375,0.125,1]);
  expect(loaded.layers[0].keys[3].shapes[0].y).toBeCloseTo(-30,12);
});

function exchangeFixture(chain = false) {
  const p = fixture(); p.duration = 10;
  const a = p.layers[0];
  const b = clone(a); b.id = 'other-track'; b.name = 'Other';
  b.keys = [{ frame: 0, shapes: [] }, ...b.keys.map(k => ({ frame: k.frame + 2,
    shapes: k.shapes.map(s => ({ ...s, id: 'other-art', y: 40 })) }))];
  p.layers.push(b);
  if (chain) {
    a.keys.splice(1, 0, { frame: 2, shapes: [{ ...a.keys[0].shapes[0], x: 40 }] });
    b.keys.splice(2, 0, { frame: 4, shapes: [{ ...b.keys[1].shapes[0], x: 40 }] });
  }
  for (const [layer, offset] of [[a, 0], [b, 2]] as const) {
    if (chain) {
      createBasicMotionSpan(p, [layer.id], offset, offset+2, 'in');
      createBasicMotionSpan(p, [layer.id], offset+2, offset+4, 'out');
    } else createBasicMotionSpan(p, [layer.id], offset, offset+4, 'linear');
  }
  return p;
}
it('exchanges complete chains with exact artwork, recipe IDs and outside holds, then reopens and refreshes', () => {
  for (const chain of [false, true]) {
    const p = exchangeFixture(chain), before = clone(p), [a,b] = p.layers;
    moveBasicMotionSpan(p,[a.id],0,4,2,b.id,true);
    expect(a.keys.filter(k=>k.frame<=4).map(k=>k.shapes)).toEqual(before.layers[1].keys.filter(k=>k.frame>=2&&k.frame<=6).map(k=>k.shapes));
    expect(b.keys.filter(k=>k.frame>=2&&k.frame<=6).map(k=>k.shapes)).toEqual(before.layers[0].keys.map(k=>k.shapes));
    expect(a.keys.find(k=>k.frame===5)!.shapes).toEqual(before.layers[0].keys.at(-1)!.shapes);
    expect(b.keys.find(k=>k.frame===7)!.shapes).toEqual(before.layers[1].keys.at(-1)!.shapes);
    expect(a.motionSpans!.map(s=>s.id)).toEqual(before.layers[1].motionSpans!.map(s=>s.id));
    expect(b.motionSpans!.map(s=>s.id)).toEqual(before.layers[0].motionSpans!.map(s=>s.id));
    const loaded = migrateProject(JSON.parse(JSON.stringify(p)));
    for (const layer of loaded.layers) for (const span of layer.motionSpans!)
      refreshBasicMotionSpan(loaded,[layer.id],span.start,span.end);
    expect(loaded.layers.map(l=>l.keys)).toEqual(p.layers.map(l=>l.keys));
  }
});
it('rejects incomplete, edited, protected or identity-conflicting exchanges without any writes', () => {
  for (const mode of ['missing','edited','locked','mode','identity','reverse-identity','same','batch']) {
    const p = exchangeFixture(), [a,b] = p.layers;
    if (mode==='missing') delete b.motionSpans;
    if (mode==='edited') b.keys.find(k=>k.frame===3)!.shapes[0].x++;
    if (mode==='locked') b.locked=true;
    if (mode==='mode') b.drawingMode='merge';
    if (mode==='identity') b.keys.push({frame:8,shapes:clone(a.keys[0].shapes)});
    if (mode==='reverse-identity') a.keys.push({frame:8,shapes:clone(b.keys[1].shapes)});
    const before=clone(p);
    expect(()=>moveBasicMotionSpan(p,mode==='batch'?[a.id,b.id]:[a.id],0,4,2,mode==='same'?a.id:b.id,true)).toThrow();
    expect(p).toEqual(before);
  }
});

function sameTrackExchangeFixture(at = 6, chain = false) {
  const p = fixture(); p.duration = 16;
  const layer = p.layers[0], shape = layer.keys[0].shapes[0];
  layer.keys.push({ frame: at, shapes: [{ ...shape, x: 200 }] },
    { frame: at + 4, shapes: [{ ...shape, x: 280 }] });
  for (const first of [0, at]) {
    if (chain) {
      layer.keys.push({ frame: first + 2, shapes: [{ ...shape, x: first ? 240 : 40 }] });
      layer.keys.sort((a,b) => a.frame-b.frame);
      createBasicMotionSpan(p,[layer.id],first,first+2,'in');
      createBasicMotionSpan(p,[layer.id],first+2,first+4,'out');
    } else createBasicMotionSpan(p,[layer.id],first,first+4,first ? 'out' : 'in');
  }
  return p;
}
it('exchanges same-track chains in both directions while preserving every outside exposure and shared artwork IDs', () => {
  for (const at of [5,6]) for (const chain of [false,true]) for (const reverse of [false,true]) {
    const p=sameTrackExchangeFixture(at,chain), before=clone(p), layer=p.layers[0];
    const pose=(keys:typeof layer.keys,frame:number)=>keys.filter(k=>k.frame<=frame).at(-1)!.shapes;
    moveBasicMotionSpan(p,[layer.id],reverse?at:0,reverse?at+4:4,reverse?0:at,reverse?layer.id:undefined,true);
    for(let f=0;f<p.duration;f++) {
      const original=f<=4?f+at:f>=at&&f<=at+4?f-at:f;
      expect(pose(layer.keys,f)).toEqual(pose(before.layers[0].keys,original));
    }
    expect(layer.motionSpans!.map(s=>s.id)).toEqual([
      ...before.layers[0].motionSpans!.filter(s=>s.start>=at),
      ...before.layers[0].motionSpans!.filter(s=>s.end<=4),
    ].map(s=>s.id));
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
    for(const span of loaded.layers[0].motionSpans!) refreshBasicMotionSpan(loaded,[layer.id],span.start,span.end);
    expect(loaded.layers[0].keys).toEqual(layer.keys);
  }
});
it('rejects same-track overlap, partial chains and invalid second chains atomically', () => {
  for(const mode of ['overlap','shared','partial','edited','invalid','locked','missing']) {
    const p=sameTrackExchangeFixture(6,true), layer=p.layers[0];
    if(mode==='edited') layer.keys.find(k=>k.frame===7)!.shapes[0].x++;
    if(mode==='invalid') layer.keys.find(k=>k.frame===10)!.shapes[0].x=NaN;
    if(mode==='locked') layer.locked=true;
    if(mode==='missing') layer.motionSpans=layer.motionSpans!.filter(s=>s.start<6);
    const before=structuredClone(p);
    expect(()=>moveBasicMotionSpan(p,[layer.id],0,mode==='partial'?2:4,mode==='overlap'?2:mode==='shared'?4:6,undefined,true)).toThrow();
    expect(p).toEqual(before);
  }
});

it('exchanges checked tracks atomically and preserves unselected tracks', () => {
  const p=sameTrackExchangeFixture(6,true);
  for(const id of ['second','untouched']) p.layers.push({...clone(p.layers[0]),id});
  const before=clone(p), ids=p.layers.slice(0,2).map(l=>l.id);
  moveBasicMotionSpan(p,[...ids,ids[0]],0,4,6,undefined,true);
  for(const layer of p.layers.slice(0,2)) {
    expect(layer.keys.find(k=>k.frame===0)!.shapes[0].x).toBe(200);
    expect(layer.keys.find(k=>k.frame===6)!.shapes[0].x).toBe(0);
    expect(layer.keys.find(k=>k.frame===5)!.shapes[0].x).toBe(80);
    expect(layer.keys.find(k=>k.frame===11)!.shapes[0].x).toBe(280);
  }
  expect(p.layers[2]).toEqual(before.layers[2]);
});
it('does not write earlier selected tracks when a later exchange rejects', () => {
  for(const mode of ['edited','locked','missing','target']) {
    const p=sameTrackExchangeFixture(6,true);
    p.layers.push({...clone(p.layers[0]),id:'second'});
    if(mode==='edited') p.layers[1].keys.find(k=>k.frame===7)!.shapes[0].x++;
    if(mode==='locked') p.layers[1].locked=true;
    const ids=[p.layers[0].id,mode==='missing'?'missing':'second'], before=clone(p);
    expect(()=>moveBasicMotionSpan(p,ids,0,4,6,mode==='target'?'second':undefined,true)).toThrow();
    expect(p).toEqual(before);
  }
});

it('subdivides a cubic route at eased progress with dense independent Bernstein samples', () => {
  const from={x:10,y:20},to={x:90,y:55},path={startX:25,startY:-40,endX:-10,endY:70};
  const sample=(t:number)=>({x:(1-t)**3*10+3*(1-t)**2*t*35+3*(1-t)*t*t*80+t**3*90,
    y:(1-t)**3*20+3*(1-t)**2*t*(-20)+3*(1-t)*t*t*125+t**3*55});
  for(const u of [0.1,0.25,0.5,0.9]){
    const [left,right]=splitCubicMotionPath(from,to,path,u),middle=sample(u);
    for(let i=0;i<=100;i++){
      const t=i/100, a=motionPathPosition(from,middle,t,left), b=motionPathPosition(middle,to,t,right);
      expect(a.x).toBeCloseTo(sample(u*t).x,11); expect(a.y).toBeCloseTo(sample(u*t).y,11);
      expect(b.x).toBeCloseTo(sample(u+(1-u)*t).x,11); expect(b.y).toBeCloseTo(sample(u+(1-u)*t).y,11);
    }
  }
});
it('preserves cubic path keys for supported easing and refreshes both saved halves after reopening',()=>{
  for(const ease of ['linear','in','out','in-out',{kind:'cubic' as const,x1:0.15,y1:0.05,x2:0.7,y2:0.9}] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];
    p.duration=9; layer.keys[1].frame=8;
    for(const key of layer.keys) key.shapes.push({...clone(key.shapes[0]),id:'other',x:key.shapes[0].x+30,y:20});
    createBasicMotionSpan(p,ids,0,8,ease,undefined,{startX:20,startY:-30,endX:-10,endY:50});
    const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);
    expect(layer.keys).toEqual(before);
    expect(layer.motionSpans![0].path).not.toEqual(layer.motionSpans![1].path);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
    refreshBasicMotionSpan(loaded,ids,0,4); refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++) for(let j=0;j<2;j++) for(const field of ['x','y'] as const)
      expect(loaded.layers[0].keys[i].shapes[j][field]).toBeCloseTo(before[i].shapes[j][field],11);
  }
});
it('rejects late mismatched displacement without partial writes',()=>{
  const p=fixture(),layer=p.layers[0],second=clone(layer); second.id='other';p.layers.push(second);
  second.keys[0].shapes.push({...clone(second.keys[0].shapes[0]),id:'member',y:30});
  second.keys[1].shapes.push({...clone(second.keys[1].shapes[0]),id:'member',x:100,y:30});
  const ids=p.layers.map(l=>l.id);
  createBasicMotionSpan(p,ids,0,4,'linear',undefined,{startX:20,startY:-30,endX:-10,endY:50});
  const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/matching endpoint displacement/);
  expect(p).toEqual(before);
});

it('restricts distance waypoint routes inside segments and at exact corners',()=>{
  const path={startX:0,startY:0,endX:0,endY:0,distance:true,waypoints:[{x:30,y:0},{x:30,y:40}]};
  const from={x:10,y:20},to={x:70,y:60};
  const expected=(t:number)=>t<=0.3?{x:10+100*t,y:20}:t<=0.7?{x:40,y:20+100*(t-0.3)}:{x:40+100*(t-0.7),y:60};
  for(const fraction of [0.15,0.3,0.5,0.7,0.85]){
    const [left,right]=splitPreservedMotionPath(from,to,path,fraction),middle=expected(fraction);
    const a=createMotionPathSampler(from,middle,left),b=createMotionPathSampler(middle,to,right);
    for(let i=0;i<=100;i++){
      const t=i/100;
      expect(a(t).x).toBeCloseTo(expected(t*fraction).x,11);expect(a(t).y).toBeCloseTo(expected(t*fraction).y,11);
      expect(b(t).x).toBeCloseTo(expected(fraction+(1-fraction)*t).x,11);expect(b(t).y).toBeCloseTo(expected(fraction+(1-fraction)*t).y,11);
    }
  }
});
it('preserves distance waypoint spans through eased splits, JSON reopen and independent refresh',()=>{
  for(const ease of ['linear','in','out'] as const) for(const at of [2,4,6]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    createBasicMotionSpan(p,ids,0,8,ease,undefined,{startX:0,startY:0,endX:0,endY:0,distance:true,waypoints:[{x:20,y:0},{x:20,y:30}]});
    const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,at,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
    refreshBasicMotionSpan(loaded,ids,0,at);refreshBasicMotionSpan(loaded,ids,at,8);
    for(let i=0;i<before.length;i++)for(const field of ['x','y'] as const)
      expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],11);
  }
});
it('rejects unresolved or unsupported waypoint preservation atomically across tracks',()=>{
  const path={startX:0,startY:0,endX:0,endY:0,distance:true,waypoints:[{x:0,y:0}]};
  expect(()=>splitPreservedMotionPath({x:0,y:0},{x:80,y:0},path,0.5)).toThrow(/nonzero/);
  expect(()=>splitPreservedMotionPath({x:0,y:0},{x:1,y:0},{...path,waypoints:[{x:1e-300,y:0},{x:0,y:0}]},Number.MIN_VALUE)).toThrow(/unresolved/);
  const p=fixture(),second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  createBasicMotionSpan(p,[ids[0]],0,4,'linear',undefined,{...path,waypoints:[{x:20,y:10}]});
  createBasicMotionSpan(p,[ids[1]],0,4,'linear',undefined,path);
  const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/nonzero/);expect(p).toEqual(before);
});

it('preserves equal-time straight and curved waypoint junctions including independent handles',()=>{
  for(const curved of [false,true])for(const custom of [false,true]){
    const path={startX:0,startY:0,endX:0,endY:0,waypoints:[{x:20,y:30},{x:50,y:-20},{x:60,y:40}],curvedWaypoints:curved,
      ...(curved&&custom?{waypointTangents:[{x:10,y:0},{x:5,y:10},{x:10,y:5},{x:10,y:-5},{x:5,y:5}],waypointIncoming:[{x:-5,y:20},{x:-10,y:3},{x:-7,y:-9}]}:{})};
    const from={x:10,y:20},to={x:90,y:20},sample=createMotionPathSampler(from,to,path);
    for(const fraction of [0.125,0.25,0.375,0.5,0.75,0.875]){
      const [left,right]=splitPreservedMotionPath(from,to,path,fraction),middle=sample(fraction);
      const a=createMotionPathSampler(from,middle,left),b=createMotionPathSampler(middle,to,right);
      for(let i=0;i<=100;i++)for(const field of ['x','y'] as const){
        const t=i/100;
        expect(a(t)[field]).toBeCloseTo(sample(t*fraction)[field],11);
        expect(b(t)[field]).toBeCloseTo(sample(fraction+(1-fraction)*t)[field],11);
      }
    }
  }
});
it('reopens and refreshes preserved curved junction recipes without changing original keys',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
  createBasicMotionSpan(p,ids,0,8,'in',undefined,{startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:20,y:30},{x:50,y:-20},{x:60,y:40}]});
  const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
  expect(layer.motionSpans![1].path!.waypointIncoming).toHaveLength(2);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
  refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
  for(let i=0;i<before.length;i++)for(const field of ['x','y'] as const)
    expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],11);
});
it('rejects unresolved equal-time splits and later track failures atomically',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  const path={startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:20,y:30}]};
  createBasicMotionSpan(p,[ids[0]],0,4,'linear',undefined,path);
  createBasicMotionSpan(p,[ids[1]],0,4,{kind:'cubic',x1:0.15,y1:0.05,x2:0.7,y2:0.9},undefined,path);
  const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/subdivision budget/);expect(p).toEqual(before);
});

it('preserves primitive size, corner radius and stroke trajectories with paths and easing',()=>{
  for(const kind of ['rectangle','ellipse'] as const)for(const ease of ['linear','in','out',{kind:'cubic' as const,x1:0.15,y1:0.05,x2:0.7,y2:0.9}] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    const first=layer.keys[0].shapes[0],last=layer.keys[1].shapes[0];
    Object.assign(first,{kind,width:20,height:30,strokeWidth:1,...(kind==='rectangle'?{cornerRadius:0}:{})});
    Object.assign(last,{kind,width:80,height:10,strokeWidth:9,...(kind==='rectangle'?{cornerRadius:5}:{})});
    createBasicMotionSpan(p,ids,0,8,ease,{primitives:true,strokeWidth:true},{startX:20,startY:30,endX:-10,endY:40});
    const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    expect(layer.motionSpans!.every(s=>s.options?.primitives&&s.options?.strokeWidth)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
    refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(const field of ['x','y','width','height','cornerRadius','strokeWidth'] as const)
      expect(loaded.layers[0].keys[i].shapes[0][field]??0).toBeCloseTo(before[i].shapes[0][field]??0,11);
  }
});
it('rejects edited dimension or stroke poses on later tracks without partial preserved splits',()=>{
  for(const field of ['width','height','cornerRadius','strokeWidth'] as const){
    const p=fixture(),second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
    for(const layer of p.layers){Object.assign(layer.keys[0].shapes[0],{cornerRadius:0,strokeWidth:1});Object.assign(layer.keys[1].shapes[0],{width:60,height:40,cornerRadius:10,strokeWidth:8});}
    createBasicMotionSpan(p,ids,0,4,'in',{primitives:true,strokeWidth:true});
    second.keys[2].shapes[0][field]=(second.keys[2].shapes[0][field]??0)+1;
    const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/unchanged generated motion/);expect(p).toEqual(before);
  }
});

it('preserves matching contour nodes and handles with topology guards through reopen and refresh',()=>{
  for(const kind of ['bezier','polygon'] as const)for(const ease of ['in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){
      const scale=key.frame?2:1;
      Object.assign(key.shapes[0],kind==='bezier'?{kind,nodes:[{x:0,y:0,out:{x:5*scale,y:2*scale}},{x:30*scale,y:10*scale,in:{x:20*scale,y:8*scale}}]}:
        {kind,contours:[[{x:0,y:0},{x:30*scale,y:0},{x:30*scale,y:30*scale},{x:0,y:30*scale}]]});
    }
    const options=kind==='bezier'?{nodes:true,curveTangents:true,curveSelfContacts:true}:{nodes:true,contourAreas:true,contourEdges:true,contourContacts:true};
    createBasicMotionSpan(p,ids,0,8,ease,options);
    const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    expect(layer.motionSpans!.every(s=>JSON.stringify(s.options)===JSON.stringify(options))).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));
    refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){
      const a=loaded.layers[0].keys[i].shapes[0],b=before[i].shapes[0];
      const left=a.nodes??a.contours![0],right=b.nodes??b.contours![0];
      for(let n=0;n<left.length;n++)for(const part of [undefined,'in','out'] as const){
        const x=part?left[n][part]:left[n],y=part?right[n][part]:right[n];
        if(x&&y){expect(x.x).toBeCloseTo(y.x,11);expect(x.y).toBeCloseTo(y.y,11);}
      }
    }
  }
});
it('rejects changed split handles and invalid later nodes without partial ownership changes',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  for(const layer of p.layers)for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',nodes:[{x:0,y:0,out:{x:5,y:0}},{x:key.frame?40:20,y:10,in:{x:15,y:10}}]});
  createBasicMotionSpan(p,ids,0,4,'in',{nodes:true});
  second.keys[2].shapes[0].nodes![0].out!.y=1;
  const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/unchanged generated motion/);expect(p).toEqual(before);
});

it('preserves linear and radial gradient endpoints and stop positions through eased path splits',()=>{
  for(const kind of ['linear','radial'] as const)for(const ease of ['in','out',{kind:'cubic' as const,x1:0.15,y1:0.05,x2:0.7,y2:0.9}] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys)key.shapes[0].gradient={kind,from:{x:key.frame?10:0,y:key.frame?5:0},to:{x:key.frame?80:20,y:key.frame?40:10},
      stops:[{offset:0,color:'#ff0000'},{offset:key.frame?0.8:0.2,color:'#00ff00',opacity:0.4},{offset:1,color:'#0000ff'}]};
    createBasicMotionSpan(p,ids,0,8,ease,{gradientGeometry:true},{startX:20,startY:30,endX:-10,endY:40});
    const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){
      const a=loaded.layers[0].keys[i].shapes[0].gradient!,b=before[i].shapes[0].gradient!;
      for(const point of ['from','to'] as const)for(const field of ['x','y'] as const)expect(a[point][field]).toBeCloseTo(b[point][field],11);
      a.stops.forEach((stop,index)=>{expect(stop.offset).toBeCloseTo(b.stops[index].offset,11);expect(stop.color).toBe(b.stops[index].color);expect(stop.opacity).toBe(b.stops[index].opacity);});
    }
  }
});
it('rejects a later edited gradient stop without partially splitting earlier tracks',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  for(const layer of p.layers)for(const key of layer.keys)key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:key.frame?40:20,y:0},stops:[{offset:0,color:'#ff0000'},{offset:key.frame?0.8:0.2,color:'#00ff00'},{offset:1,color:'#0000ff'}]};
  createBasicMotionSpan(p,ids,0,4,'in',{gradientGeometry:true});second.keys[2].shapes[0].gradient!.stops[1].offset+=0.01;
  const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/unchanged generated motion/);expect(p).toEqual(before);
});

it('preserves individual affine and gradient basis trajectories with retained reflections',()=>{
  const matrix=(angle:number,sx:number,sy:number,shear:number):[number,number,number,number]=>{
    const c=Math.cos(angle),s=Math.sin(angle);return [c*sx,s*sx,c*shear-s*sy,s*shear+c*sy];
  };
  for(const reflection of [1,-1])for(const ease of ['in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){
      const last=key.frame>0,shape=key.shapes[0];
      shape.rotation=last?30:10;shape.transform=matrix(last?0.6:0.2,last?3:1,reflection*(last?2:1),last?0.6:0.1);
      shape.gradient={kind:'radial',from:{x:0,y:0},to:{x:20,y:0},transform:matrix(last?0.5:0.1,last?2:1,reflection, last?0.2:0),stops:[{offset:0,color:'#ff0000'},{offset:1,color:'#0000ff'}]};
    }
    createBasicMotionSpan(p,ids,0,8,ease,{affine:true,gradientBasis:true},{startX:20,startY:30,endX:-10,endY:40});
    const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){
      const a=loaded.layers[0].keys[i].shapes[0],b=before[i].shapes[0];expect(a.rotation).toBeCloseTo(b.rotation,11);
      for(let j=0;j<4;j++){expect(a.transform![j]).toBeCloseTo(b.transform![j],11);expect(a.gradient!.transform![j]).toBeCloseTo(b.gradient!.transform![j],11);}
    }
  }
});
it('rejects edited split bases and reflection changes before any track is split',()=>{
  for(const target of ['artwork','gradient'] as const){
    const p=fixture(),second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
    for(const layer of p.layers)for(const key of layer.keys){key.shapes[0].transform=[key.frame?2:1,0,0,1];key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},transform:[key.frame?2:1,0,0,1],stops:[{offset:0,color:'#ff0000'},{offset:1,color:'#0000ff'}]};}
    createBasicMotionSpan(p,ids,0,4,'in',{affine:true,gradientBasis:true});
    const shape=second.keys[2].shapes[0];(target==='artwork'?shape.transform!:shape.gradient!.transform!)[2]=0.1;
    const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/unchanged generated motion/);expect(p).toEqual(before);
    (target==='artwork'?shape.transform!:shape.gradient!.transform!)[2]=0;
    const endpoint=second.keys[4].shapes[0];(target==='artwork'?endpoint.transform!:endpoint.gradient!.transform!)[3]=-1;
    const reflected=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/reflection/);expect(p).toEqual(reflected);
  }
});

it('preserves directed multi-turn rotation through eased splits and independent refresh',()=>{
  for(const direction of ['clockwise','counterclockwise'] as const)for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    layer.keys[0].shapes[0].rotation=30;layer.keys[1].shapes[0].rotation=150;
    createBasicMotionSpan(p,ids,0,8,ease,undefined,{startX:20,startY:30,endX:-10,endY:40},{direction,turns:3});
    const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    expect(layer.motionSpans!.every(s=>s.rotation!.direction===direction&&s.rotation!.turns<3)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)expect(loaded.layers[0].keys[i].shapes[0].rotation).toBeCloseTo(before[i].shapes[0].rotation,10);
  }
});
it('rejects differing derived turn counts on a later track without partial splits',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  for(const layer of p.layers){layer.keys[0].shapes[0].rotation=0;layer.keys[1].shapes[0].rotation=0;}
  second.keys[0].shapes.push({...clone(second.keys[0].shapes[0]),id:'member',rotation:0});
  second.keys[1].shapes.push({...clone(second.keys[1].shapes[0]),id:'member',rotation:180});
  createBasicMotionSpan(p,ids,0,4,'out',undefined,undefined,{direction:'clockwise',turns:1});
  const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/shared extra-turn/);expect(p).toEqual(before);
});

it('preserves directed affine rotation with scale skew and retained reflection',()=>{
  const matrix=(angle:number,sx:number,sy:number,shear:number):[number,number,number,number]=>{
    const c=Math.cos(angle),s=Math.sin(angle);return [c*sx,s*sx,c*shear-s*sy,s*shear+c*sy];
  };
  for(const direction of ['clockwise','counterclockwise'] as const)for(const sign of [1,-1]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0;key.shapes[0].rotation=last?150:30;key.shapes[0].transform=matrix(last?0.6:0.2,last?3:1,sign*(last?2:1),last?0.5:0.1);}
    createBasicMotionSpan(p,ids,0,8,'in',{affine:true},undefined,{direction,turns:3});
    const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){
      const a=loaded.layers[0].keys[i].shapes[0],b=before[i].shapes[0];expect(a.rotation).toBeCloseTo(b.rotation,10);
      for(let j=0;j<4;j++)expect(a.transform![j]).toBeCloseTo(b.transform![j],11);
    }
  }
});

it('preserves representable solid and gradient paint through independent split refresh',()=>{
  for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];shape.fill=last?'#f0a050':'#000000';shape.stroke=last?'#000000':'#f0a050';shape.gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[{offset:0,color:shape.fill,opacity:last?0.8:0.2},{offset:1,color:shape.stroke,opacity:last?0.4:1}]};}
    createBasicMotionSpan(p,ids,0,8,ease,{paint:true});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){const a=loaded.layers[0].keys[i].shapes[0],b=before[i].shapes[0];expect(a.fill).toBe(b.fill);expect(a.stroke).toBe(b.stroke);a.gradient!.stops.forEach((stop,j)=>{expect(stop.color).toBe(b.gradient!.stops[j].color);expect(stop.opacity).toBeCloseTo(b.gradient!.stops[j].opacity!,12);});}
  }
});
it('rejects rounded paint drift on a later track without partially splitting',()=>{
  const p=fixture();p.duration=9;p.layers[0].keys[1].frame=8;const second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  for(const layer of p.layers){layer.keys[0].shapes[0].fill='#000000';layer.keys[1].shapes[0].fill=layer===second?'#030303':'#f0f0f0';}
  createBasicMotionSpan(p,ids,0,8,'linear',{paint:true});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,8,4,true)).toThrow(/rounded paint/);expect(p).toEqual(before);
});

it('preserves equal-time interior segment cuts through reopen and independent refresh',()=>{
  for(const curvedWaypoints of [false,true]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    createBasicMotionSpan(p,ids,0,8,'in',undefined,{startX:0,startY:0,endX:0,endY:0,curvedWaypoints,waypoints:[{x:20,y:30}]});
    const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(const field of ['x','y'] as const)expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],11);
  }
});

it('preserves opacity-weighted gradient fades including transparent endpoint colors',()=>{
  for(const ease of ['linear','in','out'] as const)for(const reverse of [false,true]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const opaque=(key.frame>0)!==reverse;key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[{offset:0,color:opaque?'#0000ff':'#ff0000',opacity:opaque?1:0},{offset:1,color:opaque?'#00ff00':'#ffffff',opacity:opaque?0.8:0}]};}
    createBasicMotionSpan(p,ids,0,8,ease,{paint:true,gradientPremultiplied:true});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.options?.gradientPremultiplied)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)loaded.layers[0].keys[i].shapes[0].gradient!.stops.forEach((stop,j)=>{const original=before[i].shapes[0].gradient!.stops[j];expect(stop.color).toBe(original.color);expect(stop.opacity).toBeCloseTo(original.opacity!,12);});
  }
});
it('rejects opacity-weighted rounding drift without partial splits',()=>{
  const p=fixture();p.duration=9;p.layers[0].keys[1].frame=8;const second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  for(const layer of p.layers)for(const key of layer.keys)key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:[{offset:0,color:key.frame&&layer===second?'#010101':'#000000',opacity:layer===second?(key.frame?1:0.5):0},{offset:1,color:'#ffffff'}]};
  createBasicMotionSpan(p,ids,0,8,'linear',{paint:true,gradientPremultiplied:true});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,8,4,true)).toThrow(/rounded paint/);expect(p).toEqual(before);
});

it('preserves fixed-offset gradient resampling with differing endpoint stop counts',()=>{
  for(const ease of ['linear','in','out'] as const)for(const weighted of [false,true]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys)key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:(key.frame?[0,0.25,1]:[0,0.5,0.5,1]).map((offset,index)=>({offset,color:key.frame?'#00a0f0':index>=2?'#a05000':'#000000',opacity:0.8}))};
    createBasicMotionSpan(p,ids,0,8,ease,{paint:true,gradientStops:true,gradientPremultiplied:weighted});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.options?.gradientStops===true)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){const stops=loaded.layers[0].keys[i].shapes[0].gradient!.stops,original=before[i].shapes[0].gradient!.stops;expect(stops.length).toBe(original.length);stops.forEach((stop,j)=>{expect(stop.color).toBe(original[j].color);expect(stop.offset).toBe(original[j].offset);expect(stop.opacity).toBeCloseTo(original[j].opacity!,12);});}
  }
});

it('preserves symbol source clocks and exact target playback transitions through splits',()=>{
  for(const mode of ['loop','once','single','movie'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    p.symbols=[{id:'leaf',name:'Leaf',width:20,height:20,shapes:[clone(layer.keys[0].shapes[0])],timeline:{duration:3,keys:[]}}];
    for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'symbol',symbolId:'leaf',symbolPlayback:{mode:key.frame?'movie':mode,firstFrame:key.frame?2:1}});
    createBasicMotionSpan(p,ids,0,8,'in');const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){const a=loaded.layers[0].keys[i].shapes[0],b=before[i].shapes[0];expect(a.symbolPlayback).toEqual(b.symbolPlayback);expect(a.x).toBeCloseTo(b.x,11);expect(a.symbolId).toBe('leaf');}
  }
});

it('rejects a later edited symbol phase without partially splitting earlier tracks',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  p.symbols=[{id:'leaf',name:'Leaf',width:20,height:20,shapes:[clone(second.keys[0].shapes[0])],timeline:{duration:3,keys:[]}}];
  for(const key of second.keys)Object.assign(key.shapes[0],{kind:'symbol',symbolId:'leaf',symbolPlayback:{mode:'loop',firstFrame:0}});
  createBasicMotionSpan(p,ids,0,4,'in');second.keys[2].shapes[0].symbolPlayback!.firstFrame=0;
  const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/unchanged generated motion/);expect(p).toEqual(before);
});

it('preserves ordered moving gradient groups and unequal hard-edge multiplicity',()=>{
  for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0;key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:last?40:20,y:0},stops:(last?[0,0.75,1]:[0,0.25,0.25,1]).map((offset,index)=>({offset,color:last?'#00a0f0':index>=2?'#a05000':'#000000',opacity:0.8}))};}
    createBasicMotionSpan(p,ids,0,8,ease,{paint:true,gradientGeometry:true,gradientStops:'ordered'});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.options?.gradientStops==='ordered')).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){const a=loaded.layers[0].keys[i].shapes[0].gradient!,b=before[i].shapes[0].gradient!;expect(a.stops.length).toBe(b.stops.length);a.stops.forEach((stop,j)=>{expect(stop.color).toBe(b.stops[j].color);expect(stop.offset).toBeCloseTo(b.stops[j].offset,12);expect(stop.opacity).toBeCloseTo(b.stops[j].opacity!,12);});}
  }
});

it('derives explicit gradient pairs for both halves of splitting and merging groups',()=>{
  for(const reverse of [false,true]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    const source=[0,0.4,0.4,1],target=[0,0.2,0.6,1];
    for(const key of layer.keys)key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:((key.frame>0)!==reverse?target:source).map(offset=>({offset,color:key.frame?'#f0a050':'#000000'}))};
    const pairs=reverse?[[0,0],[1,1],[2,1],[3,2]] as const:[[0,0],[1,1],[1,2],[2,3]] as const;
    createBasicMotionSpan(p,ids,0,8,'in',{paint:true,gradientGeometry:true,gradientStops:{pairs}});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    expect(layer.motionSpans![0].options!.gradientStops).toEqual({pairs:pairs.map(([a],i)=>[a,i])});expect(layer.motionSpans![1].options!.gradientStops).toEqual({pairs:pairs.map(([,b],i)=>[i,b])});
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){const a=loaded.layers[0].keys[i].shapes[0].gradient!.stops,b=before[i].shapes[0].gradient!.stops;expect(a.length).toBe(b.length);a.forEach((stop,j)=>{expect(stop.color).toBe(b[j].color);expect(stop.offset).toBeCloseTo(b[j].offset,12);});}
  }
});

it('freezes automatic gradient correspondence into independently refreshable half recipes',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
  for(const key of layer.keys)key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:(key.frame?[0,0.2,0.6,1]:[0,0.4,0.4,1]).map(offset=>({offset,color:'#000000'}))};
  createBasicMotionSpan(p,ids,0,8,'in',{paint:true,gradientGeometry:true,gradientStops:{pairs:'auto'}});const before=clone(layer.keys);
  splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
  for(const span of layer.motionSpans!)expect(Array.isArray((span.options!.gradientStops as {pairs:unknown}).pairs)).toBe(true);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
  for(let i=0;i<before.length;i++){const a=loaded.layers[0].keys[i].shapes[0].gradient!.stops,b=before[i].shapes[0].gradient!.stops;expect(a.length).toBe(b.length);a.forEach((stop,j)=>{expect(stop.color).toBe(b[j].color);expect(stop.offset).toBeCloseTo(b[j].offset,12);});}
});
it('rejects divergent automatic gradient mappings across artwork atomically',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  for(const key of layer.keys){key.shapes.push({...clone(key.shapes[0]),id:'second'});key.shapes.forEach((shape,i)=>{shape.gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:(i?[0,1]:key.frame?[0,0.2,0.6,1]:[0,0.4,1]).map(offset=>({offset,color:'#000000'}))};});}
  createBasicMotionSpan(p,ids,0,4,'in',{paint:true,gradientGeometry:true,gradientStops:{pairs:'auto'}});const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/shared correspondence/);expect(p).toEqual(before);
});

it('preserves compound contour alignment on the right half without realigning the split key',()=>{
  for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    const rings=[[{x:0,y:0},{x:20,y:0},{x:0,y:20}],[{x:30,y:0},{x:40,y:0},{x:30,y:10}]];
    for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'polygon',contours:key.frame?[rings[1],rings[0]].map(r=>[r[1],r[0],r[2]].map(p=>({x:p.x*2,y:p.y*2}))):clone(rings)});
    const correspondence={order:[1,0],start:[1,1],reverse:[true,true]};
    createBasicMotionSpan(p,ids,0,8,ease,{nodes:true},undefined,undefined,correspondence);const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans![0].correspondence).toBeUndefined();expect(layer.motionSpans![1].correspondence).toEqual(correspondence);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)loaded.layers[0].keys[i].shapes[0].contours!.forEach((ring,r)=>ring.forEach((point,n)=>{const original=before[i].shapes[0].contours![r][n];expect(point.x).toBeCloseTo(original.x,11);expect(point.y).toBeCloseTo(original.y,11);}));
  }
});

it('preserves leader-pivot rigid group rotation translation and extra turns',()=>{
  for(const direction of ['shortest','clockwise','counterclockwise'] as const)for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,groups:['outer','inner']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10:0)});}
    createBasicMotionSpan(p,ids,0,8,ease,undefined,undefined,{direction,turns:direction==='shortest'?0:1,rigidGroups:true,groupDepth:1});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.rotation?.rigidGroups&&s.rotation.groupDepth===1)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=before[i].shapes[j];for(const field of ['x','y','rotation'] as const)expect(a[field]).toBeCloseTo(b[field],10);expect(a.groups).toEqual(b.groups);}
  }
});

it('preserves rigid member orbits along cubic and waypoint leader paths',()=>{
  for(const path of [
    {startX:20,startY:40,endX:-10,endY:20},
    {startX:0,startY:0,endX:0,endY:0,distance:true,waypoints:[{x:20,y:0},{x:20,y:30}]},
    {startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:20,y:30}]},
  ]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10:0)});}
    createBasicMotionSpan(p,ids,0,8,'in',undefined,path,{direction:'clockwise',turns:1,rigidGroups:true});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++)for(const field of ['x','y','rotation'] as const)expect(loaded.layers[0].keys[i].shapes[j][field]).toBeCloseTo(before[i].shapes[j][field],10);
  }
});

it('preserves uniform group scaling with rotation and optional leader paths',()=>{
  for(const scale of [0.5,2,3])for(const ease of ['linear','in','out'] as const)for(const path of [undefined,{startX:20,startY:40,endX:-10,endY:20}]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0],k=last?scale:1;Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,transform:[k,0,0,k],groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10*scale:0)});}
    createBasicMotionSpan(p,ids,0,8,ease,{affine:true},path,{direction:'clockwise',turns:1,rigidGroups:true,uniformGroupScale:true});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.rotation?.uniformGroupScale)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=before[i].shapes[j];for(const field of ['x','y','rotation'] as const)expect(a[field]).toBeCloseTo(b[field],10);a.transform!.forEach((v,k)=>expect(v).toBeCloseTo(b.transform![k],12));}
  }
});

it('preserves nonrotating group axis scaling and shear with independent refresh',()=>{
  for(const [sx,sy,hx,hy] of [[2,0.5,0,0],[2,1,0.5,0],[1,2,0,0.5],[2,3,0.5,0.25]])for(const direction of ['shortest','clockwise'] as const)for(const path of [undefined,{startX:20,startY:40,endX:-10,endY:20}]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:0,transform:last?[sx,hy,hx,sy]:[1,0,0,1],groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?10*sx+5*hx:10),y:shape.y+(last?10*hy+5*sy:5)});}
    createBasicMotionSpan(p,ids,0,8,'in',{affine:true},path,{direction,turns:0,rigidGroups:true,axisGroupScale:true,...(hx||hy?{axisGroupShear:true}:{})});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.rotation?.axisGroupScale)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=before[i].shapes[j];for(const field of ['x','y','rotation'] as const)expect(a[field]).toBeCloseTo(b[field],10);a.transform!.forEach((v,k)=>expect(v).toBeCloseTo(b.transform![k],12));}
  }
});

it('rejects an edited rotating axis group on a later track without partially splitting',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='other';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  for(const [index,layer] of p.layers.entries())for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{rotation:last&&index?90:0,transform:last?[2,0,0,0.5]:[1,0,0,1],groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?(index?0:20):10),y:shape.y+(last&&index?20:0)});}
  createBasicMotionSpan(p,ids,0,4,'linear',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true});second.keys.find(k=>k.frame===2)!.shapes[0].transform![0]+=0.1;const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/unchanged generated/);expect(p).toEqual(before);
});

it('preserves saved group pivots with pathless rotation and uniform scaling',()=>{
  for(const scale of [undefined,0.5,2])for(const ease of ['linear','in','out'] as const)for(const direction of ['shortest','clockwise'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0],k=last?(scale??1):1;Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,transform:[k,0,0,k],pivot:{x:15,y:-8},groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10*(scale??1):0)});}
    createBasicMotionSpan(p,ids,0,8,ease,scale?{affine:true}:undefined,undefined,{direction,turns:direction==='shortest'?0:1,rigidGroups:true,...(scale?{uniformGroupScale:true}:{}),savedGroupPivots:true});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.rotation?.savedGroupPivots)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=before[i].shapes[j];for(const field of ['x','y','rotation'] as const)expect(a[field]).toBeCloseTo(b[field],10);expect(a.pivot).toEqual(b.pivot);a.transform!.forEach((v,k)=>expect(v).toBeCloseTo(b.transform![k],12));}
  }
});

it('preserves saved pivots through nonrotating combined shear and rejects path pivots atomically',()=>{
  for(const path of [undefined,{startX:20,startY:40,endX:-10,endY:20,distance:true}]){
    const p=fixture(),ids=[p.layers[0].id],layer=p.layers[0];
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{pivot:{x:12,y:-7},transform:last?[2,0.25,0.5,3]:[1,0,0,1],groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?20:10),y:shape.y+(last?2.5:0)});}
    createBasicMotionSpan(p,ids,0,4,'in',{affine:true},path,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true,savedGroupPivots:true});const before=clone(p);
    if(path){expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/trajectory numerically/);expect(p).toEqual(before);continue;}
    splitBasicMotionSpan(p,ids,0,4,2,true);expect(layer.keys).toEqual(before.layers[0].keys);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,2);refreshBasicMotionSpan(loaded,ids,2,4);
    for(let i=0;i<layer.keys.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=layer.keys[i].shapes[j];expect(a.x).toBeCloseTo(b.x,10);expect(a.y).toBeCloseTo(b.y,10);expect(a.pivot).toEqual(b.pivot);a.transform!.forEach((v,k)=>expect(v).toBeCloseTo(b.transform![k],12));}
  }
});

it('derives custom group pivots with pathless rotation and uniform scaling',()=>{
  for(const scale of [undefined,0.5,2])for(const ease of ['linear','in','out'] as const)for(const direction of ['shortest','clockwise'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0],k=last?(scale??1):1;Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,transform:[k,0,0,k],pivot:{x:15,y:-8},groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10*(scale??1):0)});}
    createBasicMotionSpan(p,ids,0,8,ease,scale?{affine:true}:undefined,undefined,{direction,turns:direction==='shortest'?0:1,rigidGroups:true,...(scale?{uniformGroupScale:true}:{}),rigidPivot:{x:15,y:-8}});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.rotation?.rigidPivot)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=before[i].shapes[j];for(const field of ['x','y','rotation'] as const)expect(a[field]).toBeCloseTo(b[field],10);expect(a.pivot).toEqual(b.pivot);a.transform!.forEach((v,k)=>expect(v).toBeCloseTo(b.transform![k],12));}
  }
});


it('derives custom pivots through nonrotating combined shear and rejects path pivots atomically',()=>{
  for(const path of [undefined,{startX:20,startY:40,endX:-10,endY:20,distance:true}]){
    const p=fixture(),ids=[p.layers[0].id],layer=p.layers[0];
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{pivot:{x:12,y:-7},transform:last?[2,0.25,0.5,3]:[1,0,0,1],groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?20:10),y:shape.y+(last?2.5:0)});}
    createBasicMotionSpan(p,ids,0,4,'in',{affine:true},path,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,axisGroupShear:true,rigidPivot:{x:12,y:-7}});const before=clone(p);
    if(path){expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/trajectory numerically/);expect(p).toEqual(before);continue;}
    splitBasicMotionSpan(p,ids,0,4,2,true);expect(layer.keys).toEqual(before.layers[0].keys);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,2);refreshBasicMotionSpan(loaded,ids,2,4);
    for(let i=0;i<layer.keys.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=layer.keys[i].shapes[j];expect(a.x).toBeCloseTo(b.x,10);expect(a.y).toBeCloseTo(b.y,10);expect(a.pivot).toEqual(b.pivot);a.transform!.forEach((v,k)=>expect(v).toBeCloseTo(b.transform![k],12));}
  }
});


it('rejects incompatible custom pivot offsets across groups without writes',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{rotation:last?90:0,groups:['first']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10:0)});const second={...clone(shape),id:'second',x:shape.x+40,rotation:0,groups:['second']};key.shapes.push(second,{...clone(second),id:'second-member',x:second.x+10});}
  createBasicMotionSpan(p,ids,0,4,'linear',undefined,undefined,{direction:'shortest',turns:0,rigidGroups:true,rigidPivot:{x:15,y:-8}});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/shared transformed pivot/);expect(p).toEqual(before);
});

it('preserves cubic reference paths with custom or saved pivots',()=>{
  for(const saved of [false,true])for(const scale of [undefined,0.5,2])for(const ease of ['linear','in','out'] as const)for(const direction of ['shortest','clockwise'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0],k=last?(scale??1):1;Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,transform:[k,0,0,k],pivot:{x:15,y:-8},groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10*(scale??1):0)});}
    createBasicMotionSpan(p,ids,0,8,ease,scale?{affine:true}:undefined,{startX:20,startY:40,endX:-10,endY:20},{direction,turns:direction==='shortest'?0:1,rigidGroups:true,...(scale?{uniformGroupScale:true}:{}),...(saved?{savedGroupPivots:true}:{rigidPivot:{x:15,y:-8}})});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.rotation?.rigidPivot||s.rotation?.savedGroupPivots)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=before[i].shapes[j];for(const field of ['x','y','rotation'] as const)expect(a[field]).toBeCloseTo(b[field],10);expect(a.pivot).toEqual(b.pivot);a.transform!.forEach((v,k)=>expect(v).toBeCloseTo(b.transform![k],12));}
  }
});



it('rejects divergent saved-pivot leader corrections before splitting paths',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{rotation:last?90:0,pivot:{x:15,y:-8},groups:['first']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10:0)});const second={...clone(shape),id:'second',x:shape.x+40,rotation:0,groups:['second']};key.shapes.push(second,{...clone(second),id:'second-member',x:second.x+10});}
  createBasicMotionSpan(p,ids,0,4,'linear',undefined,{startX:20,startY:40,endX:-10,endY:20},{direction:'shortest',turns:0,rigidGroups:true,savedGroupPivots:true});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/shared leader correction/);expect(p).toEqual(before);
});

it('preserves straight and curved waypoint pivot paths at junctions and interior cuts',()=>{
  for(const path of [{startX:0,startY:0,endX:0,endY:0,waypoints:[{x:20,y:30}]},{startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:20,y:30}]}])for(const saved of [false,true])for(const scale of [undefined,0.5,2])for(const ease of ['linear','in','out'] as const)for(const direction of ['shortest','clockwise'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0],k=last?(scale??1):1;Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,transform:[k,0,0,k],pivot:{x:15,y:-8},groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10*(scale??1):0)});}
    createBasicMotionSpan(p,ids,0,8,ease,scale?{affine:true}:undefined,path,{direction,turns:direction==='shortest'?0:1,rigidGroups:true,...(scale?{uniformGroupScale:true}:{}),...(saved?{savedGroupPivots:true}:{rigidPivot:{x:15,y:-8}})});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.rotation?.rigidPivot||s.rotation?.savedGroupPivots)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=before[i].shapes[j];for(const field of ['x','y','rotation'] as const)expect(a[field]).toBeCloseTo(b[field],10);expect(a.pivot).toEqual(b.pivot);a.transform!.forEach((v,k)=>expect(v).toBeCloseTo(b.transform![k],12));}
  }
});

it('preserves rotating axis scale and shear in the right half basis',()=>{
  for(const pivot of ['leader','saved','custom'] as const)for(const [sx,sy,hx,hy] of [[2,0.5,0,0],[2,1,0.5,0],[1,2,0,0.5],[2,3,0.5,0.25]])for(const direction of ['shortest','clockwise'] as const)for(const path of [undefined,{startX:20,startY:40,endX:-10,endY:20}]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,pivot:{x:15,y:-8},transform:last?[sx,hy,hx,sy]:[1,0,0,1],groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?-(10*hy+5*sy):10),y:shape.y+(last?10*sx+5*hx:5)});}
    createBasicMotionSpan(p,ids,0,8,'in',{affine:true},path,{direction,turns:direction==='shortest'?0:1,rigidGroups:true,...(pivot==='saved'?{savedGroupPivots:true}:pivot==='custom'?{rigidPivot:{x:15,y:-8}}:{}),axisGroupScale:true,...(hx||hy?{axisGroupShear:true}:{})});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.rotation?.axisGroupScale)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++){const a=loaded.layers[0].keys[i].shapes[j],b=before[i].shapes[j];for(const field of ['x','y','rotation'] as const)expect(a[field]).toBeCloseTo(b[field],10);a.transform!.forEach((v,k)=>expect(v).toBeCloseTo(b.transform![k],12));}
  }
});

it('preserves unhinted curve matching across different endpoint node counts',()=>{
  for(const reverse of [false,true])for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    const from=[{x:0,y:0,out:{x:10,y:30}},{x:40,y:0,in:{x:30,y:30}}];
    const to=[{x:0,y:0,out:{x:8,y:-15}},{x:20,y:20,in:{x:12,y:10},out:{x:28,y:30}},{x:40,y:0,in:{x:32,y:-10}}];
    for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',closed:false,nodes:key.frame?to:from});
    createBasicMotionSpan(p,ids,0,8,ease,{nodes:true},undefined,undefined,{nodes:{curves:true},reverse});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans![0].correspondence).toEqual({nodes:{curves:true}});
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){const a=loaded.layers[0].keys[i].shapes[0].nodes!,b=before[i].shapes[0].nodes!;expect(a.length).toBe(b.length);a.forEach((node,j)=>{for(const part of [undefined,'in','out'] as const){const x=part?node[part]:node,y=part?b[j][part]:b[j];expect(Boolean(x)).toBe(Boolean(y));if(x&&y){expect(x.x).toBeCloseTo(y.x,11);expect(x.y).toBeCloseTo(y.y,11);}}});}
  }
});

it('rejects incompatible curve partitions on a later track atomically',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='second';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  for(const [i,layer] of p.layers.entries())for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',closed:false,nodes:Array.from({length:(key.frame?3:2)+i},(_,j)=>({x:j*12,y:j%2?20:0}))});
  createBasicMotionSpan(p,ids,0,4,'linear',{nodes:true},undefined,undefined,{nodes:{curves:true}});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow();expect(p).toEqual(before);
});

it('preserves reconstructable straight matching for open paths and closed contours',()=>{
  for(const closed of [false,true])for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    const from=closed?[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]:[{x:0,y:0},{x:40,y:0}];
    const to=closed?[{x:0,y:0},{x:20,y:0},{x:40,y:0},{x:40,y:20},{x:40,y:40},{x:20,y:40},{x:0,y:40},{x:0,y:20}]:[{x:0,y:0},{x:24,y:0},{x:80,y:0}];
    for(const key of layer.keys)Object.assign(key.shapes[0],closed?{kind:'polygon',contours:[key.frame?to:from]}:{kind:'bezier',closed:false,nodes:key.frame?to:from});
    createBasicMotionSpan(p,ids,0,8,ease,{nodes:true},undefined,undefined,{nodes:true});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.correspondence?.nodes===true)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){const a=loaded.layers[0].keys[i].shapes[0],b=before[i].shapes[0],first=closed?a.contours![0]:a.nodes!,last=closed?b.contours![0]:b.nodes!;expect(first.length).toBe(last.length);first.forEach((v,j)=>{expect(v.x).toBeCloseTo(last[j].x,11);expect(v.y).toBeCloseTo(last[j].y,11);});}
  }
});

it('rejects changing straight arc-length partitions on a later track atomically',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='second';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  for(const [i,layer] of p.layers.entries())for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',closed:false,nodes:key.frame?[{x:0,y:0},{x:20,y:i?30:0},{x:80,y:0}]:[{x:0,y:0},{x:40,y:0}]});
  createBasicMotionSpan(p,ids,0,4,'linear',{nodes:true},undefined,undefined,{nodes:true});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow();expect(p).toEqual(before);
});

it('remaps explicit straight and curve hints through expanded split nodes',()=>{
  for(const curves of [false,true]){
  const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
  const from=[{x:0,y:0},{x:20,y:20},{x:40,y:0}],to=[{x:0,y:0},{x:10,y:20},{x:20,y:30},{x:30,y:20},{x:40,y:0}];
  for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',closed:false,nodes:(key.frame?to:from).map(v=>curves?v:{...v,y:0})});
  createBasicMotionSpan(p,ids,0,8,'in',{nodes:true},undefined,undefined,{nodes:{curves,hints:[[[1,2]]]}});const before=clone(layer.keys);
  splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
  expect(layer.motionSpans![0].correspondence!.nodes).toEqual({curves,hints:[[[1,2]]]});expect(layer.motionSpans![1].correspondence!.nodes).toEqual({curves,hints:[[[2,2]]]});
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
  for(let i=0;i<before.length;i++){const a=loaded.layers[0].keys[i].shapes[0].nodes!,b=before[i].shapes[0].nodes!;expect(a.length).toBe(b.length);a.forEach((v,j)=>{for(const part of [undefined,'in','out'] as const){const x=part?v[part]:v,y=part?b[j][part]:b[j];expect(Boolean(x)).toBe(Boolean(y));if(x&&y){expect(x.x).toBeCloseTo(y.x,11);expect(x.y).toBeCloseTo(y.y,11);}}});}
}
});

it('rejects divergent expanded hint indices across artwork atomically',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  for(const key of layer.keys){const shape=key.shapes[0];Object.assign(shape,{kind:'bezier',closed:false,nodes:[0,10,20,30].map(x=>({x,y:0}))});key.shapes.push({...clone(shape),id:'second',nodes:(key.frame?[0,5,20,30]:[0,10,20,30]).map(x=>({x,y:0}))});}
  createBasicMotionSpan(p,ids,0,4,'linear',{nodes:true},undefined,undefined,{nodes:{hints:[[[2,2]]]}});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/shared expanded indices/);expect(p).toEqual(before);
});


it('preserves reconstructable distance curve matching with optional hints',()=>{
  for(const hinted of [false,true])for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    const nodes=[{x:0,y:0,out:{x:8,y:16}},{x:24,y:0,in:{x:16,y:16},out:{x:32,y:-16}},{x:48,y:0,in:{x:40,y:-16}}];
    for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',closed:false,nodes:nodes.map(n=>({x:n.x*(key.frame && !hinted && ease==='linear'?2:1),y:n.y,...(n.in?{in:{x:n.in.x*(key.frame && !hinted && ease==='linear'?2:1),y:n.in.y*(key.frame && !hinted && ease==='linear'?2:1)}}:{}),...(n.out?{out:{x:n.out.x*(key.frame && !hinted && ease==='linear'?2:1),y:n.out.y*(key.frame && !hinted && ease==='linear'?2:1)}}:{})}))});
    const matching={curves:true,distance:true,...(hinted?{hints:[[[1,1] as const]]}:{})};
    createBasicMotionSpan(p,ids,0,8,ease,{nodes:true},undefined,undefined,{nodes:matching});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);
    expect(layer.motionSpans!.every(s=>JSON.stringify(s.correspondence?.nodes)===JSON.stringify(matching))).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++){const a=loaded.layers[0].keys[i].shapes[0].nodes!,b=before[i].shapes[0].nodes!;expect(a.length).toBe(b.length);a.forEach((v,j)=>{for(const part of [undefined,'in','out'] as const){const x=part?v[part]:v,y=part?b[j][part]:b[j];expect(Boolean(x)).toBe(Boolean(y));if(x&&y){expect(x.x).toBeCloseTo(y.x,11);expect(x.y).toBeCloseTo(y.y,11);}}});}
  }
});

it('rejects changing distance curve partitions on a later track atomically',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='second';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  for(const [i,layer] of p.layers.entries())for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',closed:false,nodes:key.frame&&i?[{x:0,y:0,out:{x:10,y:30}},{x:20,y:20,out:{x:30,y:-10}},{x:80,y:0}]:[{x:0,y:0,out:{x:10,y:30}},{x:40,y:0,in:{x:30,y:30}}]});
  createBasicMotionSpan(p,ids,0,4,'linear',{nodes:true},undefined,undefined,{nodes:{curves:true,distance:true}});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow();expect(p).toEqual(before);
});


it('preserves reconstructable single cubic distance paths',()=>{
  for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    layer.keys[0].shapes[0].x=0;layer.keys[0].shapes[0].y=0;layer.keys[1].shapes[0].x=96;layer.keys[1].shapes[0].y=0;
    createBasicMotionSpan(p,ids,0,8,ease,undefined,{startX:32,startY:ease==='linear'?32:0,endX:-32,endY:ease==='linear'?32:0,distance:true});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,4,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.path?.distance)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);refreshBasicMotionSpan(loaded,ids,4,8);
    for(let i=0;i<before.length;i++)for(const field of ['x','y'] as const)expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],11);
  }
});

it('rejects drifting single cubic distance tables atomically',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
  createBasicMotionSpan(p,ids,0,8,'in',undefined,{startX:20,startY:10,endX:-20,endY:10,distance:true});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,8,4,true)).toThrow();expect(p).toEqual(before);
});


it('preserves reconstructable curved distance waypoint routes at boundaries and inside segments',()=>{
  for(const at of [2,4,6]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    layer.keys[0].shapes[0].x=0;layer.keys[0].shapes[0].y=0;layer.keys[1].shapes[0].x=96;layer.keys[1].shapes[0].y=0;
    const path={startX:0,startY:0,endX:0,endY:0,distance:true,curvedWaypoints:true,waypoints:[{x:48,y:0}],waypointTangents:[{x:16,y:0},{x:16,y:0},{x:16,y:0}],waypointIncoming:[{x:-16,y:0}]};
    createBasicMotionSpan(p,ids,0,8,'linear',undefined,path);const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,8,at,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.path?.distance)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,at);refreshBasicMotionSpan(loaded,ids,at,8);
    for(let i=0;i<before.length;i++)for(const field of ['x','y'] as const)expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],11);
  }
});

it('rejects curved waypoint distance drift on a later track atomically',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='second';p.layers.push(second);p.duration=9;for(const l of p.layers)l.keys[1].frame=8;
  createBasicMotionSpan(p,[p.layers[0].id],0,8,'linear');
  createBasicMotionSpan(p,[second.id],0,8,'in',undefined,{startX:0,startY:0,endX:0,endY:0,distance:true,curvedWaypoints:true,waypoints:[{x:20,y:30},{x:50,y:-20}]});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,p.layers.map(l=>l.id),0,8,4,true)).toThrow();expect(p).toEqual(before);
});


it('preserves symmetric curved distance waypoint halves at resolved samples',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  layer.keys[0].shapes[0].x=0;layer.keys[0].shapes[0].y=0;layer.keys[1].shapes[0].x=96;layer.keys[1].shapes[0].y=0;
  const path={startX:0,startY:0,endX:0,endY:0,distance:true,curvedWaypoints:true,waypoints:[{x:48,y:0}],waypointTangents:[{x:16,y:16},{x:16,y:16},{x:16,y:-16}],waypointIncoming:[{x:-16,y:16}]};
  createBasicMotionSpan(p,ids,0,4,'linear',undefined,path);const before=clone(layer.keys);
  splitBasicMotionSpan(p,ids,0,4,2,true);expect(layer.keys).toEqual(before);
  const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,2);refreshBasicMotionSpan(loaded,ids,2,4);
  for(let i=0;i<before.length;i++)for(const field of ['x','y'] as const)expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],11);
});


it('preserves tangent cubic paths with exactly zero split heading',()=>{
  for(const distance of [false,true]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];
    layer.keys[0].shapes[0].x=0;layer.keys[0].shapes[0].y=0;layer.keys[1].shapes[0].x=96;layer.keys[1].shapes[0].y=0;
    createBasicMotionSpan(p,ids,0,4,'linear',undefined,{startX:32,startY:distance?0:32,endX:-32,endY:distance?0:32,tangent:true,distance});const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,4,2,true);expect(layer.keys).toEqual(before);expect(layer.motionSpans!.every(s=>s.path?.tangent)).toBe(true);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,2);refreshBasicMotionSpan(loaded,ids,2,4);
    for(let i=0;i<before.length;i++)for(const field of ['x','y','rotation'] as const)expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],11);
  }
});

it('preserves nonzero tangent split headings on later tracks atomically',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='second';p.layers.push(second);
  createBasicMotionSpan(p,[p.layers[0].id],0,4,'linear');
  createBasicMotionSpan(p,[second.id],0,4,'linear',undefined,{startX:20,startY:30,endX:-20,endY:10,tangent:true});const before=clone(p);
  splitBasicMotionSpan(p,p.layers.map(l=>l.id),0,4,2,true);expect(p.layers.map(l=>l.keys)).toEqual(before.layers.map(l=>l.keys));
});


it('preserves saved and custom pivot translations on distance routes',()=>{
  for(const saved of [false,true])for(const waypoints of [false,true]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];
    for(const key of layer.keys){const a=key.shapes[0];Object.assign(a,{x:key.frame?96:0,y:0,rotation:0,groups:['pair'],pivot:{x:15,y:-8}});key.shapes.push({...clone(a),id:'member',x:a.x+10});}
    const rotation={direction:'shortest' as const,turns:0,rigidGroups:true,...(saved?{savedGroupPivots:true}:{rigidPivot:{x:15,y:-8}})};
    const path=waypoints?{startX:0,startY:0,endX:0,endY:0,distance:true,waypoints:[{x:48,y:24}]}:{startX:32,startY:32,endX:-32,endY:32,distance:true};
    createBasicMotionSpan(p,ids,0,4,'linear',undefined,path,rotation);const before=clone(layer.keys);
    splitBasicMotionSpan(p,ids,0,4,2,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,2);refreshBasicMotionSpan(loaded,ids,2,4);
    for(let i=0;i<before.length;i++)for(let j=0;j<2;j++)for(const field of ['x','y','rotation'] as const)expect(loaded.layers[0].keys[i].shapes[j][field]).toBeCloseTo(before[i].shapes[j][field],11);
  }
});


it('rejects nonzero distance pivot corrections without changing artwork',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  for(const key of layer.keys){const a=key.shapes[0];Object.assign(a,{x:key.frame?96:0,y:0,rotation:key.frame?90:0,groups:['pair']});key.shapes.push({...clone(a),id:'member',x:a.x+(key.frame?0:10),y:key.frame?10:0});}
  createBasicMotionSpan(p,ids,0,4,'linear',undefined,{startX:32,startY:32,endX:-32,endY:32,distance:true},{direction:'shortest',turns:0,rigidGroups:true,rigidPivot:{x:15,y:-8}});const before=clone(p);
  expect(()=>splitBasicMotionSpan(p,ids,0,4,2,true)).toThrow(/zero leader correction/);expect(p).toEqual(before);
});


it('reverses an isolated remembered recipe with derived easing and cubic path, retaining outside holds',()=>{
  for(const path of [undefined,{startX:20,startY:30,endX:-10,endY:20}]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=8;
    createBasicMotionSpan(p,ids,0,4,'in',undefined,path);const before=clone(layer.keys),recipe=layer.motionSpans![0].id;
    reverseBasicMotionSpan(p,ids,0,4);expect(layer.motionSpans![0].id).toBe(recipe);expect(layer.motionSpans![0].ease).toBe('out');
    for(const k of before)expect(layer.keys.find(v=>v.frame===4-k.frame)!.shapes).toEqual(k.shapes);
    expect(layer.keys.find(k=>k.frame===5)!.shapes).toEqual(before.find(k=>k.frame===4)!.shapes);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);
    for(let f=1;f<4;f++)expect(loaded.layers[0].keys.find(k=>k.frame===f)!.shapes[0].x).toBeCloseTo(before.find(k=>k.frame===4-f)!.shapes[0].x,11);
  }
});

it('rejects stale later-track reversal without mutating the first track',()=>{
  const p=fixture(),second=clone(p.layers[0]);second.id='second';p.layers.push(second);const ids=p.layers.map(l=>l.id);
  createBasicMotionSpan(p,ids,0,4,'linear');second.keys[2].shapes[0].x+=1;const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,ids,0,4)).toThrow(/unchanged/);expect(p).toEqual(before);
});


it('reverses symbol base recipes without changing the source definition',()=>{
  const p=fixture(),layer=p.layers[0];
  const definition={id:'symbol',name:'Symbol',width:100,height:100,shapes:layer.keys[0].shapes,timeline:{duration:8,keys:layer.keys.slice(1)}};
  const created=editSymbolBasicMotionSpan(definition,['@base'],0,4,'create','in');const before=clone(created);
  const result=editSymbolBasicMotionSpan(created,['@base'],0,4,'reverse');expect(created).toEqual(before);
  expect(result.shapes).toEqual(before.timeline!.keys.find(k=>k.frame===4)!.shapes);
  expect(result.timeline!.motionSpans![0].ease).toBe('out');expect(result.timeline!.keys.find(k=>k.frame===5)!.shapes).toEqual(result.shapes);
});

it('rejects connected recipe reversal without detaching either neighbor',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];createBasicMotionSpan(p,ids,0,4,'linear');splitBasicMotionSpan(p,ids,0,4,2,true);const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,ids,0,2)).toThrow(/isolated/);expect(p).toEqual(before);
});


it('reverses straight and frozen curved waypoint recipes with exact keys and refresh',()=>{
  for(const curved of [false,true])for(const distance of [false,true]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=8;
    const path={startX:0,startY:0,endX:0,endY:0,waypoints:[{x:20,y:30}],curvedWaypoints:curved,distance};
    createBasicMotionSpan(p,ids,0,4,'linear',undefined,path);const before=clone(layer.keys);
    reverseBasicMotionSpan(p,ids,0,4);
    for(const k of before)expect(layer.keys.find(v=>v.frame===4-k.frame)!.shapes).toEqual(k.shapes);
    if(curved)expect(layer.motionSpans![0].path!.waypointIncoming).toHaveLength(1);
    refreshBasicMotionSpan(p,ids,0,4);
    for(const k of before)expect(layer.keys.find(v=>v.frame===4-k.frame)!.shapes[0].x).toBeCloseTo(k.shapes[0].x,11);
  }
});


it('freezes independent incoming handles when reversing unequal curved segments',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  const path={startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:16,y:32},{x:64,y:-8}],waypointTangents:[{x:8,y:16},{x:24,y:4},{x:12,y:8},{x:8,y:-8}],waypointIncoming:[{x:-4,y:12},{x:-16,y:-4}]};
  createBasicMotionSpan(p,ids,0,4,'linear',undefined,path);const before=clone(layer.keys);
  reverseBasicMotionSpan(p,ids,0,4);
  expect(layer.motionSpans![0].path!.waypointTangents![1]).toEqual(path.waypointIncoming[1]);
  for(const k of before)expect(layer.keys.find(v=>v.frame===4-k.frame)!.shapes).toEqual(k.shapes);
});

it('rejects different waypoint endpoint displacements atomically',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  for(const key of layer.keys){const other=clone(key.shapes[0]);other.id='other';other.x+=key.frame*5;key.shapes.push(other);}
  createBasicMotionSpan(p,ids,0,4,'linear',undefined,{startX:0,startY:0,endX:0,endY:0,waypoints:[{x:20,y:30}]});const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,ids,0,4)).toThrow(/shared endpoint/);expect(p).toEqual(before);
});


it('reverses unequal connected spans with recipe identities, refresh and outside holds',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=12;
  layer.keys[1].frame=6;
  createBasicMotionSpan(p,ids,0,6,'linear');splitBasicMotionSpan(p,ids,0,6,2,true);
  const before=clone(layer.keys),recipes=clone(layer.motionSpans!);
  reverseBasicMotionSpan(p,ids,0,6);
  expect(layer.motionSpans!.map(s=>[s.id,s.start,s.end])).toEqual([[recipes[1].id,0,4],[recipes[0].id,4,6]]);
  for(const key of before)expect(layer.keys.find(k=>k.frame===6-key.frame)!.shapes).toEqual(key.shapes);
  expect(layer.keys.find(k=>k.frame===7)!.shapes).toEqual(before.at(-1)!.shapes);
  refreshBasicMotionSpan(p,ids,0,4);refreshBasicMotionSpan(p,ids,4,6);
});

it('rejects stale final chain members before any selected track writes',()=>{
  const p=fixture(),layer=p.layers[0];createBasicMotionSpan(p,[layer.id],0,4,'linear');splitBasicMotionSpan(p,[layer.id],0,4,2,true);
  const second=clone(layer);second.id='second';p.layers.push(second);second.keys[3].shapes[0].x++;
  const before=clone(p);expect(()=>reverseBasicMotionSpan(p,[layer.id,second.id],0,4)).toThrow(/unchanged/);expect(p).toEqual(before);
});


it('rejects reversal ranges outside duration without changing stored chains',()=>{
  const p=fixture(),layer=p.layers[0];createBasicMotionSpan(p,[layer.id],0,4,'linear');p.duration=4;
  const before=clone(p);expect(()=>reverseBasicMotionSpan(p,[layer.id],0,4)).toThrow(/existing timeline/);expect(p).toEqual(before);
});


it('reverses leader-pivot groups with uniform scaling and leader paths',()=>{
  for(const scale of [0.5,1,2])for(const ease of ['linear','in','out'] as const)for(const path of [undefined,{startX:20,startY:40,endX:-10,endY:20},{startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:20,y:30}]}]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0],k=last?scale:1;Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,transform:[k,0,0,k],groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10*scale:0)});}
    createBasicMotionSpan(p,ids,0,8,ease,{affine:true},path,{direction:'shortest',turns:0,rigidGroups:true,uniformGroupScale:true});const before=clone(layer.keys);
    reverseBasicMotionSpan(p,ids,0,8);
    for(const key of before)expect(layer.keys.find(k=>k.frame===8-key.frame)!.shapes).toEqual(key.shapes);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,8);
    for(const key of before)for(let j=0;j<2;j++)for(const field of ['x','y','rotation'] as const)expect(loaded.layers[0].keys.find(k=>k.frame===8-key.frame)!.shapes[j][field]).toBeCloseTo(key.shapes[j][field],10);
  }
});



it('reverses ancestry-scoped nested groups while retaining ungrouped artwork',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  for(const key of layer.keys){const shape=key.shapes[0];shape.groups=['outer','inner'];key.shapes.push({...clone(shape),id:'member',x:shape.x+10},{...clone(shape),id:'loose',groups:undefined,x:shape.x+40});}
  createBasicMotionSpan(p,ids,0,4,'in',undefined,undefined,{direction:'shortest',turns:0,rigidGroups:true,groupDepth:1});const before=clone(layer.keys);
  reverseBasicMotionSpan(p,ids,0,4);for(const key of before)expect(layer.keys.find(k=>k.frame===4-key.frame)!.shapes).toEqual(key.shapes);
});


it('reverses pathless saved and custom pivots with group rotation and uniform scaling',()=>{
  for(const saved of [false,true])for(const scale of [0.5,1,2])for(const ease of ['linear','in','out'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0],k=last?scale:1;Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,transform:[k,0,0,k],pivot:{x:15,y:-8},groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10*scale:0)});}
    createBasicMotionSpan(p,ids,0,8,ease,{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,uniformGroupScale:true,...(saved?{savedGroupPivots:true}:{rigidPivot:{x:15,y:-8}})});const before=clone(layer.keys);
    reverseBasicMotionSpan(p,ids,0,8);
    if(!saved){expect(layer.motionSpans![0].rotation!.rigidPivot!.x).toBeCloseTo(8*scale,12);expect(layer.motionSpans![0].rotation!.rigidPivot!.y).toBeCloseTo(15*scale,12);}
    for(const key of before)expect(layer.keys.find(k=>k.frame===8-key.frame)!.shapes).toEqual(key.shapes);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,8);
    for(const key of before)for(let j=0;j<2;j++)for(const field of ['x','y','rotation'] as const)expect(loaded.layers[0].keys.find(k=>k.frame===8-key.frame)!.shapes[j][field]).toBeCloseTo(key.shapes[j][field],10);
  }
});


it('rejects divergent transformed custom group pivots without reversing any artwork',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{rotation:last?90:0,groups:['first']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?0:10),y:shape.y+(last?10:0)});const second={...clone(shape),id:'second',x:shape.x+40,rotation:0,groups:['second']};key.shapes.push(second,{...clone(second),id:'second-member',x:second.x+10});}
  createBasicMotionSpan(p,ids,0,4,'linear',undefined,undefined,{direction:'shortest',turns:0,rigidGroups:true,rigidPivot:{x:15,y:-8}});const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,ids,0,4)).toThrow(/shared transformed/);expect(p).toEqual(before);
});


it('reverses independent group axes and shear in the rotated endpoint basis',()=>{
  for(const [sx,sy,hx,hy] of [[2,0.5,0,0],[2,1,0.5,0],[1,2,0,0.5],[2,3,0.5,0.25]])for(const angle of [0,45,90])for(const pivot of ['leader','custom','saved'] as const){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?angle:0,transform:last?[sx,hy,hx,sy]:[1,0,0,1],pivot:{x:12,y:-7},groups:['pair']});const x=last?10*sx+5*hx:10,y=last?10*hy+5*sy:5;key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?x*Math.cos(angle*Math.PI/180)-y*Math.sin(angle*Math.PI/180):x),y:shape.y+(last?x*Math.sin(angle*Math.PI/180)+y*Math.cos(angle*Math.PI/180):y)});}
    createBasicMotionSpan(p,ids,0,8,'in',{affine:true},undefined,{direction:'shortest',turns:0,rigidGroups:true,axisGroupScale:true,...(hx||hy?{axisGroupShear:true}:{}),...(pivot==='custom'?{rigidPivot:{x:12,y:-7}}:pivot==='saved'?{savedGroupPivots:true}:{})});const before=clone(layer.keys);
    reverseBasicMotionSpan(p,ids,0,8);expect(layer.motionSpans![0].rotation!.axisGroupShear).toBe(true);
    for(const key of before)expect(layer.keys.find(k=>k.frame===8-key.frame)!.shapes).toEqual(key.shapes);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,8);
    for(const key of before)for(let j=0;j<2;j++)for(const field of ['x','y','rotation'] as const)expect(loaded.layers[0].keys.find(k=>k.frame===8-key.frame)!.shapes[j][field]).toBeCloseTo(key.shapes[j][field],10);
  }
});


it('reverses saved and custom pivot routes with rotation and axis shear',()=>{
  for(const saved of [false,true])for(const axes of [false,true])for(const path of [{startX:20,startY:40,endX:-10,endY:20},{startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:20,y:30}]},{startX:0,startY:0,endX:0,endY:0,distance:true,waypoints:[{x:20,y:0},{x:20,y:30}]}]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=9;layer.keys[1].frame=8;
    for(const key of layer.keys){const last=key.frame>0,shape=key.shapes[0];Object.assign(shape,{x:last?100:20,y:last?50:30,rotation:last?90:0,transform:last?(axes?[2,0.25,0.5,3]:[2,0,0,2]):[1,0,0,1],pivot:{x:12,y:-7},groups:['pair']});key.shapes.push({...clone(shape),id:'member',x:shape.x+(last?(axes?-2.5:0):10),y:shape.y+(last?20:0)});}
    createBasicMotionSpan(p,ids,0,8,'in',{affine:true},path,{direction:'shortest',turns:0,rigidGroups:true,...(axes?{axisGroupScale:true,axisGroupShear:true}:{uniformGroupScale:true}),...(saved?{savedGroupPivots:true}:{rigidPivot:{x:12,y:-7}})});const before=clone(layer.keys);
    reverseBasicMotionSpan(p,ids,0,8);
    for(const key of before)expect(layer.keys.find(k=>k.frame===8-key.frame)!.shapes).toEqual(key.shapes);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,8);
    for(const key of before)for(let j=0;j<2;j++)for(const field of ['x','y','rotation'] as const)expect(loaded.layers[0].keys.find(k=>k.frame===8-key.frame)!.shapes[j][field]).toBeCloseTo(key.shapes[j][field],10);
  }
});


it('rejects stale later pivot routes before reversing earlier tracks',()=>{
  const p=fixture(),first=p.layers[0],second=clone(first);second.id='second';p.layers.push(second);
  for(const layer of p.layers){for(const key of layer.keys){const shape=key.shapes[0];shape.groups=['pair'];key.shapes.push({...clone(shape),id:'member',x:shape.x+10});}
    createBasicMotionSpan(p,[layer.id],0,4,'linear',undefined,{startX:20,startY:30,endX:-10,endY:20},{direction:'shortest',turns:0,rigidGroups:true,rigidPivot:{x:12,y:4}});}
  second.keys[2].shapes[1].x++;const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,[first.id,second.id],0,4)).toThrow(/unchanged/);expect(p).toEqual(before);
});


it('reverses node matching and swaps explicit source target hints',()=>{
  for(const curves of [false,true])for(const hints of [false,true]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];
    for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',closed:false,nodes:key.frame?[{x:0,y:0},{x:10,y:20},{x:20,y:30},{x:30,y:20},{x:40,y:0}]:[{x:0,y:0},{x:20,y:20},{x:40,y:0}]});
    const nodes=hints?{curves,hints:[[[1,2] as const]]}:curves?{curves:true}:true;
    createBasicMotionSpan(p,ids,0,4,'linear',{nodes:true},undefined,undefined,{nodes});const before=clone(layer.keys);
    reverseBasicMotionSpan(p,ids,0,4);
    if(hints)expect(layer.motionSpans![0].correspondence!.nodes).toEqual({curves,hints:[[[2,1]]]});
    for(const key of before)expect(layer.keys.find(k=>k.frame===4-key.frame)!.shapes).toEqual(key.shapes);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);
    for(const key of before)expect(loaded.layers[0].keys.find(k=>k.frame===4-key.frame)!.shapes[0].nodes).toEqual(key.shapes[0].nodes);
  }
});


it('reverses reconstructable distance curve matching while retaining explicit hints',()=>{
  const p=fixture(),layer=p.layers[0],ids=[layer.id];
  for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',closed:false,nodes:[{x:0,y:0,out:{x:8,y:16}},{x:24,y:0,in:{x:16,y:16},out:{x:32,y:-16}},{x:48,y:0,in:{x:40,y:-16}}]});
  createBasicMotionSpan(p,ids,0,4,'in',{nodes:true},undefined,undefined,{nodes:{curves:true,distance:true,hints:[[[1,1]]]}});const before=clone(layer.keys);
  reverseBasicMotionSpan(p,ids,0,4);
  expect(layer.motionSpans![0].correspondence!.nodes).toEqual({curves:true,distance:true,hints:[[[1,1]]]});
  for(const key of before)expect(layer.keys.find(k=>k.frame===4-key.frame)!.shapes).toEqual(key.shapes);
  refreshBasicMotionSpan(p,ids,0,4);
});

it('rejects stale later node matching recipes without reversing earlier tracks',()=>{
  const p=fixture(),first=p.layers[0],second=clone(first);second.id='second';p.layers.push(second);
  for(const layer of p.layers){for(const key of layer.keys)Object.assign(key.shapes[0],{kind:'bezier',closed:false,nodes:key.frame?[{x:0,y:0},{x:20,y:10},{x:40,y:0}]:[{x:0,y:0},{x:40,y:0}]});createBasicMotionSpan(p,[layer.id],0,4,'linear',{nodes:true},undefined,undefined,{nodes:true});}
  second.keys[2].shapes[0].nodes![1].y++;const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,[first.id,second.id],0,4)).toThrow(/unchanged/);expect(p).toEqual(before);
});


it('reverses explicit and resolved automatic gradient stop correspondence',()=>{
  for(const automatic of [false,true]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];
    for(const key of layer.keys)key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:(key.frame?[0,0.2,0.6,1]:[0,0.4,1]).map(offset=>({offset,color:'#000000'}))};
    createBasicMotionSpan(p,ids,0,4,'linear',{paint:true,gradientGeometry:true,gradientStops:{pairs:automatic?'auto':[[0,0],[1,1],[1,2],[2,3]]}});const before=clone(layer.keys);
    reverseBasicMotionSpan(p,ids,0,4);
    if(!automatic)expect(layer.motionSpans![0].options!.gradientStops).toEqual({pairs:[[0,0],[1,1],[2,1],[3,2]]});
    expect(typeof layer.motionSpans![0].options!.gradientStops).toBe('object');
    for(const key of before)expect(layer.keys.find(k=>k.frame===4-key.frame)!.shapes).toEqual(key.shapes);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,4);
    for(const key of before)expect(loaded.layers[0].keys.find(k=>k.frame===4-key.frame)!.shapes[0].gradient).toEqual(key.shapes[0].gradient);
  }
});


it('rejects stale later gradient correspondence without changing earlier tracks',()=>{
  const p=fixture(),first=p.layers[0],second=clone(first);second.id='second';p.layers.push(second);
  for(const layer of p.layers){for(const key of layer.keys)key.shapes[0].gradient={kind:'linear',from:{x:0,y:0},to:{x:20,y:0},stops:(key.frame?[0,0.2,0.6,1]:[0,0.4,1]).map(offset=>({offset,color:'#000000'}))};createBasicMotionSpan(p,[layer.id],0,4,'linear',{paint:true,gradientGeometry:true,gradientStops:{pairs:[[0,0],[1,1],[1,2],[2,3]]}});}
  second.keys[2].shapes[0].gradient!.stops[1].offset+=0.01;const before=clone(p);
  expect(()=>reverseBasicMotionSpan(p,[first.id,second.id],0,4)).toThrow(/unchanged/);expect(p).toEqual(before);
});

it('uses the aggregate subdivision budget for exact fine waypoint cuts',()=>{
  for(const curvedWaypoints of [false,true])for(const end of [256,512]){
    const p=fixture(),layer=p.layers[0],ids=[layer.id];p.duration=end+1;layer.keys[1].frame=end;
    createBasicMotionSpan(p,ids,0,end,'linear',undefined,{startX:0,startY:0,endX:0,endY:0,curvedWaypoints,waypoints:[{x:20,y:30}]});
    const before=clone(layer.keys);splitBasicMotionSpan(p,ids,0,end,2,true);expect(layer.keys).toEqual(before);
    const loaded=migrateProject(JSON.parse(JSON.stringify(p)));refreshBasicMotionSpan(loaded,ids,0,2);refreshBasicMotionSpan(loaded,ids,2,end);
    for(let i=0;i<before.length;i++)for(const field of ['x','y'] as const)expect(loaded.layers[0].keys[i].shapes[0][field]).toBeCloseTo(before[i].shapes[0][field],10);
  }
});

it('rejects fine trajectory over-budget and stale later-track cuts atomically',()=>{
  for(const stale of [false,true]){
    const p=fixture();p.duration=1025;p.layers[0].keys[1].frame=1024;
    if(stale){const second=clone(p.layers[0]);second.id='second';p.layers.push(second);}
    const ids=p.layers.map(l=>l.id),end=stale?512:1024;
    for(const layer of p.layers){layer.keys[1].frame=end;createBasicMotionSpan(p,[layer.id],0,end,'linear',undefined,{startX:0,startY:0,endX:0,endY:0,curvedWaypoints:true,waypoints:[{x:20,y:30}]});}
    if(stale)p.layers[1].keys[3].shapes[0].x+=1;
    const before=clone(p);expect(()=>splitBasicMotionSpan(p,ids,0,end,2,true)).toThrow();expect(p).toEqual(before);
  }
});
