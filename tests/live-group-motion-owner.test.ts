import { captureLiveGroupCubicControls } from '../packages/animation/src/live-group-cubic-controls';
import { expect, it, vi } from 'vitest';
import { MAX_SYMBOL_ARTWORK, validateProject, type Project } from '../packages/document/src';
import { liveRotationFixture, secondRotationTrack } from './live-motion-rotation-fixture';
import {
  captureLiveGroupMotionAuthoringFrame as capture,
  prepareSplitLiveGroupMotionSpans as split,
  type LiveGroupSplitRequest,
  type LiveGroupOwner,
} from '../packages/animation/src/live-group-motion-owner';
import {
  captureLiveMotionAuthoringFrame as captureRoot,
  prepareSplitLiveMotionSpans as splitRoot,
  type LiveRootOwner,
} from '../packages/animation/src/live-motion-owner';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
function fixture(mode = 'rigid', basis = 'plain') {
  const { p } = liveRotationFixture(mode, basis, true);
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) {
      shape.x += 80;
      shape.y += 80;
    }
  return p;
}
function operation(p = fixture(), frame = 4, group = 'outer') {
  const view = capture(() => ({ project: p, revision: 7, frame }));
  return { view, requests: [{ owner: view.resolve('track', group), rightSpanId: 'right' }] };
}
function equivalent(a: Project, b: Project) {
  const av = captureLiveMotionTimeline(() => ({ project: a, revision: 0 })),
    bv = captureLiveMotionTimeline(() => ({ project: b, revision: 0 }));
  try {
    for (let frame = 0; frame < a.duration; frame++) {
      const x = av.sample(frame),
        y = bv.sample(frame);
      expect(y.map((t) => t.layerId)).toEqual(x.map((t) => t.layerId));
      x.forEach((track, i) =>
        expect(sameMotionArtwork(track.key.shapes, y[i].key.shapes), `frame ${frame}`).toBe(true),
      );
    }
  } finally {
    av.dispose();
    bv.dispose();
  }
}
for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const frame of [2, 4, 6])
      it(`prepares privately captured complete ${mode}/${basis} groups at ${frame}`, () => {
        const p = fixture(mode, basis),
          before = structuredClone(p),
          { view, requests } = operation(p, frame, 'second'),
          owner = requests[0].owner;
        expect(owner.shapeId).toBe('c');
        expect(owner.groupId).toBe('second');
        expect(owner.groupShapeIds).toEqual(['c', 'd']);
        expect(owner.shapeIds).toEqual(['a', 'b', 'c', 'd', 'loose']);
        expect(Object.isFrozen(owner)).toBe(true);
        expect(Object.isFrozen(owner.groupShapeIds)).toBe(true);
        expect(Object.isFrozen(owner.shapeIds)).toBe(true);
        const out = split(requests);
        validateProject(out);
        equivalent(p, out);
        expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, frame, 8, 10]);
        expect(out.layers[0].keys[1].shapes).toEqual(view.scene[0].key.shapes);
        for (const key of before.layers[0].keys)
          expect(out.layers[0].keys.find((k) => k.frame === key.frame)).toEqual(key);
        expect({ ...out, layers: [] }).toEqual({ ...before, layers: [] });
        expect(p).toEqual(before);
        out.layers[0].keys[0].shapes[0].x = 999;
        expect(p).toEqual(before);
        view.dispose();
        expect(() => split(requests)).toThrow(/disposed/);
      });
it('public scenes/choices/method replacement cannot own private original membership', () => {
  const p = fixture(),
    { view, requests } = operation(p),
    scene = view.scene,
    hints = view.choices;
  scene[0].key.shapes[0].x = 999;
  hints[0].groupId = 'forged';
  expect(() => view.resolve('track', 'forged')).toThrow();
  expect(() => view.resolve('track', 'inner')).toThrow();
  expect(() => view.resolve('track', 'loose')).toThrow();
  const original = structuredClone(p);
  equivalent(p, split(requests));
  expect(p).toEqual(original);
  view.resolve = () => ({ ...requests[0].owner });
  expect(() => split([{ owner: view.resolve('track', 'outer'), rightSpanId: 'right' }])).toThrow(
    /private/,
  );
  view.dispose();
});
for (const frame of [0, 1, 7, 8, 9, 10])
  it(`rejects non-split-space frame ${frame}`, () => {
    const p = fixture(),
      view = capture(() => ({ project: p, revision: 0, frame }));
    expect(view.choices).toEqual([]);
    expect(() => view.resolve('track', 'outer')).toThrow();
    view.dispose();
  });
for (const field of ['locked', 'visible'] as const)
  it(`excludes ${field} tracks`, () => {
    const p = fixture();
    p.layers[0][field] = field === 'locked';
    const view = capture(() => ({ project: p, revision: 0, frame: 4 }));
    expect(view.choices).toEqual([]);
    view.dispose();
  });
for (const field of ['source', 'identity', 'revision', 'frame'])
  it(`rejects observed ${field} changes permanently`, () => {
    let p = fixture(),
      revision = 0,
      frame = 4;
    const view = capture(() => ({ project: p, revision, frame })),
      owner = view.resolve('track', 'outer');
    if (field === 'source') p.name = 'Separate source edit';
    if (field === 'identity') p = structuredClone(p);
    if (field === 'revision') revision++;
    if (field === 'frame') frame++;
    expect(() => split([{ owner, rightSpanId: 'right' }])).toThrow();
    expect(() => view.scene).toThrow(/disposed/);
  });
for (const kind of ['copy', 'json', 'hint', 'root', 'crossScope', 'duplicate'])
  it(`rejects ${kind} owners and whole-span duplicate requests`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, requests } = operation(p),
      other = operation(p),
      root = captureRoot(() => ({ project: p, revision: 7, frame: 4 }));
    const rows: LiveGroupSplitRequest[] = [...requests];
    if (kind === 'copy') rows[0] = { ...rows[0], owner: { ...rows[0].owner } };
    if (kind === 'json') rows[0] = { ...rows[0], owner: JSON.parse(JSON.stringify(rows[0].owner)) };
    if (kind === 'hint') rows[0] = { ...rows[0], owner: view.choices[0] as LiveGroupOwner };
    if (kind === 'root') {
      expect(root.choices).toEqual([]);
      rows[0] = { ...rows[0], owner: {} as LiveGroupOwner };
    }
    if (kind === 'crossScope') rows.push(other.requests[0]);
    if (kind === 'duplicate')
      rows.push({ owner: view.resolve('track', 'second'), rightSpanId: 'another' });
    expect(() => split(rows)).toThrow();
    expect(() =>
      splitRoot([{ owner: requests[0].owner as LiveRootOwner, rightSpanId: 'right' }]),
    ).toThrow();
    expect(p).toEqual(before);
    view.dispose();
    other.view.dispose();
    root.dispose();
  });
for (const id of ['', 'live', undefined, 2, NaN])
  it(`rejects invalid right identity ${id}`, () => {
    const p = fixture(),
      before = structuredClone(p),
      { view, requests } = operation(p);
    requests[0].rightSpanId = id as string;
    expect(() => split(requests)).toThrow();
    expect(p).toEqual(before);
    view.dispose();
  });
for (const field of [
  'owner',
  'rightSpanId',
  'callback',
  'inheritedCallback',
  'source',
  'sourceField',
])
  it(`rejects ${field} accessors with zero reads`, () => {
    const p = fixture();
    let reads = 0;
    const getter = () => {
      reads++;
      return 1;
    };
    if (field === 'source') {
      Object.defineProperty(p, 'duration', { enumerable: true, get: getter });
      expect(() => operation(p)).toThrow();
    } else if (field === 'sourceField') {
      expect(() =>
        capture(() => ({
          get project() {
            reads++;
            return p;
          },
          revision: 0,
          frame: 4,
        })),
      ).toThrow();
    } else {
      const { view, requests } = operation(p);
      const options: { validate?: () => void } = {};
      if (field === 'callback')
        Object.defineProperty(options, 'validate', { enumerable: true, get: getter });
      else if (field === 'inheritedCallback')
        Object.setPrototypeOf(options, {
          get validate() {
            reads++;
            return () => {};
          },
        });
      else Object.defineProperty(requests[0], field, { enumerable: true, get: getter });
      expect(() => split(requests, options)).toThrow();
      view.dispose();
    }
    expect(reads).toBe(0);
  });
it('rejects async admission and swallowed preparation reentry without poisoning fresh requests', () => {
  const p = fixture(),
    before = structuredClone(p),
    { view, requests } = operation(p);
  expect(() => split(requests, { validate: () => Promise.resolve() as unknown as void })).toThrow(
    /synchronous/,
  );
  let hit = false;
  expect(() =>
    split(requests, {
      validate: () => {
        if (!hit) {
          hit = true;
          try {
            split(requests);
          } catch {
            /*swallowed*/
          }
        }
      },
    }),
  ).toThrow(/reenter/);
  expect(hit).toBe(true);
  expect(p).toEqual(before);
  equivalent(p, split(requests));
  view.dispose();
});
it('rejects source-reader reentry even when swallowed', () => {
  const p = fixture();
  let active = false;
  const view = capture(() => {
    if (active) {
      try {
        void view.scene;
      } catch {
        /*swallowed*/
      }
    }
    return { project: p, revision: 0, frame: 4 };
  });
  active = true;
  expect(() => view.scene).toThrow();
  expect(() => view.choices).toThrow(/disposed/);
});
it('rejects changed owner identity despite equal public metadata', () => {
  const p = fixture(),
    { view, requests } = operation(p);
  expect(() =>
    split(requests, {
      validate: () => {
        requests[0].owner = { ...requests[0].owner };
      },
    }),
  ).toThrow(/changed/);
  view.dispose();
});
function twoTracks() {
  const p = fixture();
  secondRotationTrack(p);
  return p;
}
function both(p: Project) {
  const view = capture(() => ({ project: p, revision: 0, frame: 4 }));
  return {
    view,
    requests: ['track', 'later'].map((layerId) => ({
      owner: view.resolve(layerId, 'outer'),
      rightSpanId: 'right',
    })),
  };
}
it('prepares two tracks atomically and preserves all unrequested source/settings/library', () => {
  const p = twoTracks(),
    before = structuredClone(p),
    { view, requests } = both(p),
    out = split(requests);
  for (const layer of out.layers) expect(layer.keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
  equivalent(p, out);
  expect(p).toEqual(before);
  view.dispose();
});
it('rejects a later unresolved split and never returns an earlier prepared layer', () => {
  const p = twoTracks();
  p.layers[1].keys[1].frame = 10;
  p.layers[1].keys[2].frame = 11;
  Object.assign(p.layers[1].liveMotionSpans![0], { end: 10, ease: 'in-out' });
  const before = structuredClone(p),
    { view, requests } = both(p);
  let output: Project | undefined;
  expect(() => {
    output = split(requests);
  }).toThrow(/Preserved/);
  expect(output).toBeUndefined();
  expect(p).toEqual(before);
  expect(split(requests.slice(0, 1)).layers[1]).toEqual(before.layers[1]);
  view.dispose();
});
for (const late of ['source', 'target', 'output'])
  it(`rejects actual ${late} changes after complete candidate cloning`, () => {
    const p = fixture(),
      { view, requests } = operation(p),
      before = structuredClone(p),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v),
        q = v as Project;
      if (
        !hit &&
        q?.layers?.[0]?.keys.some((k) => k.frame === 4) &&
        q.layers[0].liveMotionSpans?.length === 2
      ) {
        hit = true;
        if (late === 'source') p.name = 'Separate source edit';
        if (late === 'target') requests[0].rightSpanId = 'changed';
        if (late === 'output') (out as Project).layers[0].keys[1].shapes[0].x++;
      }
      return out;
    });
    try {
      expect(() => split(requests)).toThrow();
      expect(hit).toBe(true);
      if (late === 'source') before.name = 'Separate source edit';
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
      view.dispose();
    }
    const fresh = operation(p);
    equivalent(p, split(fresh.requests));
    fresh.view.dispose();
  });
for (const what of ['snapshot', 'scene', 'publicHint'])
  it(`rejects corrupted ${what} clones`, () => {
    const p = fixture(),
      clone = structuredClone;
    let hit = false;
    const modify = (v: unknown) => {
      const out = clone(v);
      if (
        !hit &&
        ((what === 'snapshot' && v === p) ||
          (what === 'scene' && Array.isArray(out) && out[0]?.key) ||
          (what === 'publicHint' && Array.isArray(out) && out[0]?.groupId))
      ) {
        hit = true;
        if (what === 'snapshot') (out as Project).name = 'Forged';
        else if (Array.isArray(out)) {
          if (what === 'scene') out[0].key.shapes[0].x++;
          else out[0].groupId = 'forged';
        }
      }
      return out;
    };
    if (what === 'publicHint') {
      const { view } = operation(p);
      vi.stubGlobal('structuredClone', modify);
      try {
        expect(() => view.choices).toThrow();
        expect(hit).toBe(true);
      } finally {
        vi.unstubAllGlobals();
        view.dispose();
      }
    } else {
      vi.stubGlobal('structuredClone', modify);
      try {
        expect(() => operation(p)).toThrow();
        expect(hit).toBe(true);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });

for (const mode of ['hole', 'inherited', 'hidden', 'extra'])
  it(`rejects raw ${mode} request ownership without executing inherited getters`, () => {
    const p = fixture(),
      { view, requests } = operation(p);
    let reads = 0;
    const rows = [...requests];
    if (mode === 'hole') delete rows[0];
    if (mode === 'inherited') {
      delete (rows[0] as Partial<LiveGroupSplitRequest>).owner;
      Object.setPrototypeOf(rows[0], {
        get owner() {
          reads++;
          return requests[0].owner;
        },
      });
    }
    if (mode === 'hidden')
      Object.defineProperty(rows[0], 'rightSpanId', { value: 'right', enumerable: false });
    if (mode === 'extra') Object.assign(rows, { extra: 1 });
    expect(() => split(rows)).toThrow();
    expect(reads).toBe(0);
    expect(p.layers[0].keys).toHaveLength(3);
    view.dispose();
  });
for (const late of ['source', 'target', 'output'])
  it(`rechecks ${late} after final source-reader admission`, () => {
    const p = fixture(),
      before = structuredClone(p),
      clone = structuredClone;
    let output: Project | undefined,
      hit = false;
    let requests: LiveGroupSplitRequest[] = [];
    const view = capture(() => {
      if (
        output &&
        !hit &&
        (new Error().stack ?? '').includes('prepareSplitLiveGroupMotionSpans')
      ) {
        hit = true;
        if (late === 'source') p.name = 'Late reader source edit';
        if (late === 'target') requests[0].rightSpanId = 'changed';
        if (late === 'output') output.layers[0].keys[1].shapes[0].x++;
      }
      return { project: p, revision: 0, frame: 4 };
    });
    requests = [{ owner: view.resolve('track', 'outer'), rightSpanId: 'right' }];
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v),
        q = v as Project;
      if (
        q?.layers?.[0]?.keys.some((k) => k.frame === 4) &&
        q.layers[0].liveMotionSpans?.length === 2
      )
        output = out as Project;
      return out;
    });
    try {
      expect(() => split(requests)).toThrow();
      expect(hit).toBe(true);
      if (late === 'source') before.name = 'Late reader source edit';
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
      view.dispose();
    }
    const fresh = operation(p);
    equivalent(p, split(fresh.requests));
    fresh.view.dispose();
  });
it('invalidates preparation reentry from the very first source admission and allows a source-valid retry', () => {
  const p = fixture();
  let armed = false,
    hit = false;
  let requests: LiveGroupSplitRequest[] = [];
  const view = capture(() => {
    if (armed && !hit) {
      hit = true;
      try {
        split(requests);
      } catch {
        /*swallowed*/
      }
    }
    return { project: p, revision: 0, frame: 4 };
  });
  requests = [{ owner: view.resolve('track', 'outer'), rightSpanId: 'right' }];
  armed = true;
  expect(() => split(requests)).toThrow(/reenter/);
  expect(hit).toBe(true);
  equivalent(p, split(requests));
  view.dispose();
});
for (const route of ['cubic', 'heading', 'straightDistance'])
  it(`preserves privately captured shared ${route} paths and original metadata`, () => {
    const p = fixture(),
      span = p.layers[0].liveMotionSpans![0];
    span.path =
      route === 'straightDistance'
        ? { startX: 80 / 3, startY: 0, endX: -80 / 3, endY: 0, distance: true }
        : {
            startX: 0,
            startY: 40,
            endX: 0,
            endY: 40,
            ...(route === 'heading'
              ? { tangent: true, headingOffset: 10, headingOffsetEnd: 20 }
              : {}),
          };
    const a = p.layers[0].keys[0].shapes.at(-1)!,
      b = p.layers[0].keys[1].shapes.at(-1)!;
    b.x = a.x + 80;
    b.y = a.y;
    const before = structuredClone(p),
      { view, requests } = operation(p),
      out = split(requests);
    equivalent(p, out);
    expect(p).toEqual(before);
    view.dispose();
  });
it('fresh reopened group owners support further sparse splitting with complete original identity', () => {
  const p = fixture();
  p.duration = 20;
  p.layers[0].keys[1].frame = 16;
  p.layers[0].keys[2].frame = 18;
  p.layers[0].liveMotionSpans![0].end = 16;
  const a = operation(p, 8),
    out = split(a.requests),
    loaded = JSON.parse(JSON.stringify(out)) as Project,
    b = operation(loaded, 4, 'second');
  b.requests[0].rightSpanId = 'middle';
  const again = split(b.requests);
  equivalent(p, again);
  expect(again.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8, 16, 18]);
  expect(again.layers[0].liveMotionSpans!.map((s) => s.id)).toEqual(['live', 'middle', 'right']);
  a.view.dispose();
  b.view.dispose();
});
it('retains a single frozen complete ID list across original group choices without quadratic hints', () => {
  const p = fixture(),
    { view, requests } = operation(p),
    a = requests[0].owner,
    b = view.resolve('track', 'outer'),
    c = view.resolve('track', 'second');
  expect(a.shapeIds).toBe(b.shapeIds);
  expect(a.shapeIds).toBe(c.shapeIds);
  expect(a.groupShapeIds).toBe(b.groupShapeIds);
  expect(view.choices).toEqual([
    { layerId: 'track', spanId: 'live', groupId: 'outer' },
    { layerId: 'track', spanId: 'live', groupId: 'second' },
  ]);
  view.dispose();
});
it('admits actual aggregate artwork capacity and rejects original overflow without a lower ownership cap', () => {
  const p = fixture(),
    art = { ...p.symbols![0].shapes[0] };
  delete art.transform;
  delete art.pivot;
  delete art.opacity;
  p.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
    ...art,
    id: 'capacity' + i,
    points: [],
  }));
  const { view, requests } = operation(p),
    out = split(requests);
  expect(out.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(p.layers[0].keys).toHaveLength(3);
  view.dispose();
  p.symbols![0].shapes.push({ ...art, id: 'overflow' });
  expect(() => operation(p)).toThrow(/budget/);
}, 120000);

it('rejects an actual valid root split brand at the explicit group boundary', () => {
  const p = fixture();
  for (const key of p.layers[0].keys) for (const shape of key.shapes) delete shape.groups;
  delete p.layers[0].liveMotionSpans![0].rotation!.rigidGroups;
  const root = captureRoot(() => ({ project: p, revision: 0, frame: 4 })),
    owner = root.resolve('track', 'a');
  expect(() =>
    split([{ owner: owner as unknown as LiveGroupOwner, rightSpanId: 'right' }]),
  ).toThrow(/private/);
  root.dispose();
});
it('rejects an actual private group cubic brand before split geometry is considered', () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  const curve = captureLiveGroupCubicControls(() => ({ project: p, revision: 0, frame: 4 })),
    owner = curve.resolve('track', 'live', 'outer', 'start');
  expect(() =>
    split([{ owner: owner as unknown as LiveGroupOwner, rightSpanId: 'right' }]),
  ).toThrow(/private/);
  curve.dispose();
});
it('rejects aggregate overflow injected into complete edited output and preserves fresh retries', () => {
  const p = fixture(),
    before = structuredClone(p),
    { view, requests } = operation(p),
    clone = structuredClone;
  let hit = false;
  vi.stubGlobal('structuredClone', (v: unknown) => {
    const out = clone(v),
      q = v as Project;
    if (
      !hit &&
      q?.layers?.[0]?.keys.some((k) => k.frame === 4) &&
      q.layers[0].liveMotionSpans?.length === 2
    ) {
      hit = true;
      const target = out as Project,
        art = target.symbols![0].shapes[0];
      target.symbols![0].shapes = Array.from({ length: MAX_SYMBOL_ARTWORK + 1 }, (_, i) => ({
        ...art,
        id: 'overflow' + i,
      }));
    }
    return out;
  });
  try {
    expect(() => split(requests)).toThrow(/budget/);
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
  }
  equivalent(p, split(requests));
  view.dispose();
});

it('rejects candidate mutation during project validation before final clone admission', () => {
  const p = fixture(),
    before = structuredClone(p),
    { view, requests } = operation(p),
    stringify = JSON.stringify;
  let hit = false;
  vi.spyOn(JSON, 'stringify').mockImplementation(((...args: Parameters<typeof stringify>) => {
    const text = stringify(...args),
      q = args[0] as Project,
      stack = new Error().stack ?? '';
    if (
      !hit &&
      q?.layers?.[0]?.keys.some((k) => k.frame === 4) &&
      q.layers[0].liveMotionSpans?.length === 2 &&
      stack.includes('prepareSplitLiveGroupMotionSpans') &&
      !stack.includes('splitLiveGroupMotionLayer')
    ) {
      hit = true;
      q.layers[0].keys[1].shapes[0].x++;
    }
    return text;
  }) as typeof stringify);
  try {
    expect(() => split(requests)).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.restoreAllMocks();
  }
  equivalent(p, split(requests));
  view.dispose();
});
