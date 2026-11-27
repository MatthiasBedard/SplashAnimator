import { expect, it, vi, afterEach } from 'vitest';
import {
  newProject,
  validateProject,
  migrateProject,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type Vector,
  type LiveMotionSpan,
} from '../packages/document/src';
import {
  prepareCreateLiveMotionSpans as create,
  prepareUpdateLiveMotionSpans as update,
  prepareRemoveLiveMotionSpans as remove,
  captureLiveMotionTimeline as capture,
} from '../packages/animation/src/live-motion';
import {
  captureLiveMotionAuthoringFrame,
  prepareSplitLiveMotionSpans,
} from '../packages/animation/src/live-motion-owner';
import {
  captureLiveCubicControls,
  prepareLiveCubicControlPositions,
} from '../packages/animation/src/live-cubic-controls';
import { splitLiveMotionLayer } from '../packages/animation/src/live-motion-split';
import { liveCreationIssue } from '../apps/editor/src/live-creation';
import { createMotionFrameSampler } from '../packages/animation/src/motion-frames';
import { matrix } from '../packages/geometry/src/affine';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
type Basis = [number, number, number, number];
const mul = (a: Basis, b: Basis): Basis => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
];
const rotation = (degrees: number): Basis => {
  const a = (degrees * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)];
};
type Mode = 'rigid' | 'uniform' | 'axes' | 'shear' | 'both-shears';
function fixture(
  mode: Mode = 'rigid',
  basis: 'plain' | 'affine' | 'reflected' = 'plain',
  groups = 1,
  origin = 0,
  unit = 1,
) {
  const p = newProject();
  p.width = 300;
  p.height = 240;
  p.duration = 12;
  const m: Basis =
    basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3];
  const h: Basis =
    mode === 'rigid'
      ? [1, 0, 0, 1]
      : mode === 'uniform'
        ? [1.5, 0, 0, 1.5]
        : mode === 'axes'
          ? [2, 0, 0, 0.5]
          : mode === 'shear'
            ? [2, 0, 0.25, 0.5]
            : [2, 0.2, 0.25, 0.5];
  const shape = (id: string, x: number, y: number, angle: number, ancestry?: string[]): Vector => ({
    id,
    kind: 'rectangle',
    x,
    y,
    width: 10 * unit,
    height: 8 * unit,
    rotation: angle,
    transform: [...m],
    pivot: { x: 3, y: 4 },
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
    ...(ancestry ? { groups: ancestry } : {}),
  });
  const first: Vector[] = [],
    last: Vector[] = [];
  for (let g = 0; g < groups; g++) {
    const angle = g ? -90 : 90,
      leader = { x: origin + (10 + 120 * g) * unit, y: origin + (20 - 50 * g) * unit };
    const source = [
      shape('a' + g, leader.x, leader.y, g ? 15 : 0, ['outer' + g, 'inner' + g]),
      shape('b' + g, leader.x + 20 * unit, leader.y + 12 * unit, g ? 45 : 30, [
        'outer' + g,
        'inner' + g,
      ]),
    ];
    for (const s of source) {
      first.push(s);
      const r = rotation(angle),
        dx = s.x - leader.x,
        dy = s.y - leader.y;
      const tx = h[0] * dx + h[2] * dy,
        ty = h[1] * dx + h[3] * dy;
      const local = mul(mul(mul(rotation(-s.rotation), h), rotation(s.rotation)), m);
      last.push({
        ...structuredClone(s),
        x: leader.x + 80 * unit + r[0] * tx + r[2] * ty,
        y: leader.y + 40 * unit + r[1] * tx + r[3] * ty,
        rotation: s.rotation + angle,
        transform: local,
      });
    }
  }
  const loose = shape('loose', origin - 70 * unit, origin - 20 * unit, -20);
  first.push(loose);
  last.push({
    ...structuredClone(loose),
    x: loose.x + 40 * unit,
    y: loose.y - 20 * unit,
    rotation: 40,
  });
  p.layers[0] = {
    ...p.layers[0],
    id: 'track',
    drawingMode: 'object',
    keys: [
      { frame: 0, shapes: first },
      { frame: 8, shapes: last },
      { frame: 10, shapes: [] },
    ],
  };
  const span: LiveMotionSpan = {
    id: 'group-live',
    start: 0,
    end: 8,
    ease: 'linear',
    rotation: {
      direction: 'shortest',
      turns: 0,
      rigidGroups: true,
      ...(mode === 'uniform'
        ? { uniformGroupScale: true }
        : mode !== 'rigid'
          ? {
              axisGroupScale: true,
              ...(mode === 'shear' || mode === 'both-shears' ? { axisGroupShear: true } : {}),
            }
          : {}),
    },
    ...(mode !== 'rigid' ? { options: { affine: true } } : {}),
  };
  return { p, span, m, h, groups, unit };
}
function add(f: ReturnType<typeof fixture>) {
  return create(f.p, [{ layerId: 'track', span: f.span }]);
}
function sample(p: Project, frame = 4) {
  const v = capture(() => ({ project: p, revision: 0 }));
  try {
    return v.sample(frame)[0].key.shapes;
  } finally {
    v.dispose();
  }
}
function checkWorld(actual: Vector[], f: ReturnType<typeof fixture>, t: number) {
  const source = f.p.layers[0].keys[0].shapes;
  for (let i = 0; i < actual.length; i++) {
    const a = source[i],
      grouped = !!a.groups?.length;
    const endAngle = grouped ? (i < 2 ? 90 : -90) : 60;
    const policy = f.span.rotation!;
    const clockwise = ((endAngle % 360) + 360) % 360;
    const delta =
      policy.direction === 'clockwise'
        ? clockwise + policy.turns * 360
        : policy.direction === 'counterclockwise'
          ? (clockwise ? clockwise - 360 : 0) - policy.turns * 360
          : endAngle;
    const theta = delta * t;
    const r = rotation(theta),
      h: Basis = grouped
        ? [1 + (f.h[0] - 1) * t, f.h[1] * t, f.h[2] * t, 1 + (f.h[3] - 1) * t]
        : [1, 0, 0, 1];
    const basis = mul(mul(mul(r, h), rotation(a.rotation)), f.m);
    let x: number, y: number;
    if (grouped) {
      const leader = source[Math.floor(i / 2) * 2],
        dx = a.x - leader.x,
        dy = a.y - leader.y;
      const u = h[0] * dx + h[2] * dy,
        v = h[1] * dx + h[3] * dy;
      x = leader.x + 80 * f.unit * t + r[0] * u + r[2] * v;
      y = leader.y + 40 * f.unit * t + r[1] * u + r[3] * v;
    } else {
      x = a.x + 40 * f.unit * t;
      y = a.y - 20 * f.unit * t;
    }
    expect(actual[i].x).toBeCloseTo(x, 9);
    expect(actual[i].y).toBeCloseTo(y, 9);
    const got = matrix(actual[i]);
    for (let j = 0; j < 4; j++) expect(got[j]).toBeCloseTo(basis[j], 9);
    // Independent transformed point, rather than comparing two shared samplers.
    const local = { x: 2 * f.unit, y: 3 * f.unit };
    expect(got[0] * local.x + got[2] * local.y + got[4]).toBeCloseTo(
      basis[0] * local.x + basis[2] * local.y + x,
      9,
    );
    expect(got[1] * local.x + got[3] * local.y + got[5]).toBeCloseTo(
      basis[1] * local.x + basis[3] * local.y + y,
      9,
    );
    expect(actual[i].groups).toEqual(a.groups);
    expect(actual[i].pivot).toEqual(a.pivot);
  }
}

for (const mode of ['rigid', 'uniform', 'axes', 'shear', 'both-shears'] as const)
  for (const basis of ['plain', 'affine', 'reflected'] as const)
    for (const groups of [1, 2])
      it(`samples explicit ${mode}/${basis}/${groups} complete outer groups and loose roots sparsely`, () => {
        const f = fixture(mode, basis, groups),
          before = structuredClone(f.p),
          out = add(f),
          v = capture(() => ({ project: out, revision: 2 }));
        for (const at of [1, 2, 4, 6, 7]) checkWorld(v.sample(at)[0].key.shapes, f, at / 8);
        expect(v.sample(0)[0].key).toEqual(before.layers[0].keys[0]);
        expect(v.sample(8)[0].key).toEqual(before.layers[0].keys[1]);
        expect(v.sample(9)[0].key).toEqual(before.layers[0].keys[1]);
        expect(v.sample(10)[0].key.shapes).toEqual([]);
        expect(out.layers[0].keys).toEqual(before.layers[0].keys);
        expect(out.layers[0].motionSpans).toBeUndefined();
        expect(out.layers[0].liveMotionSpans).toEqual([f.span]);
        expect(f.p).toEqual(before);
        v.dispose();
      });

for (const [origin, unit] of [
  [10000, 0.001],
  [-10000, 0.001],
  [0, 1e-6],
])
  it(`retains relative group geometry at origin${origin}/unit${unit}`, () => {
    const f = fixture('both-shears', 'reflected', 2, origin, unit),
      out = add(f);
    checkWorld(sample(out), f, 0.5);
    expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
  });

for (const mode of [
  'omitted',
  'false',
  'depth',
  'saved',
  'pivot',
  'membership',
  'order',
  'hierarchy',
  'missing-group',
  'singleton',
  'extra-singleton',
  'symbol',
] as const)
  it(`rejects unsupported ${mode} group admission atomically`, () => {
    const f = fixture();
    if (mode === 'omitted') delete f.span.rotation!.rigidGroups;
    if (mode === 'false') f.span.rotation!.rigidGroups = false;
    if (mode === 'depth') f.span.rotation!.groupDepth = 1;
    if (mode === 'saved') f.span.rotation!.savedGroupPivots = true;
    if (mode === 'pivot') f.span.rotation!.rigidPivot = { x: 0, y: 0 };
    if (mode === 'membership') f.p.layers[0].keys[1].shapes[1].id = 'different';
    if (mode === 'order') f.p.layers[0].keys[1].shapes.reverse();
    if (mode === 'hierarchy') f.p.layers[0].keys[1].shapes[1].groups = ['outer0', 'different'];
    if (mode === 'missing-group')
      for (const k of f.p.layers[0].keys.slice(0, 2)) for (const s of k.shapes) delete s.groups;
    if (mode === 'singleton') for (const k of f.p.layers[0].keys.slice(0, 2)) k.shapes.splice(1, 1);
    if (mode === 'extra-singleton')
      for (const k of f.p.layers[0].keys.slice(0, 2)) k.shapes.at(-1)!.groups = ['solo'];
    if (mode === 'symbol')
      for (const k of f.p.layers[0].keys.slice(0, 2))
        Object.assign(k.shapes[0], { kind: 'symbol', symbolId: 'missing' });
    const before = structuredClone(f.p),
      request = structuredClone(f.span);
    expect(() => add(f)).toThrow();
    expect(f.p).toEqual(before);
    expect(f.span).toEqual(request);
  });

for (const mode of [
  'offset',
  'angle',
  'basis',
  'missing-affine',
  'nodes',
  'primitives',
  'collapse',
  'negative-scale',
  'overflow',
  'later',
] as const)
  it(`retains original sampler ${mode} rejection and all-request atomicity`, () => {
    const f = fixture('axes');
    const target = f.p.layers[0].keys[1].shapes;
    if (mode === 'offset') target[1].x += 2;
    if (mode === 'angle') target[1].rotation += 5;
    if (mode === 'basis') target[1].transform![0] += 1;
    if (mode === 'missing-affine') f.span.options!.affine = false;
    if (mode === 'nodes') f.span.options!.nodes = true;
    if (mode === 'primitives') f.span.options!.primitives = true;
    if (mode === 'collapse') for (const s of target.slice(0, 2)) s.transform = [0, 0, 0, 0];
    if (mode === 'negative-scale')
      for (const s of target.slice(0, 2)) s.transform = [-2, 0, 0, 0.5];
    if (mode === 'overflow') target[1].transform![0] = Number.MAX_VALUE;
    const requests = [{ layerId: 'track', span: f.span }];
    if (mode === 'later') {
      const later = structuredClone(f.p.layers[0]);
      later.id = 'later';
      later.keys[1].shapes[1].x += 2;
      f.p.layers.push(later);
      requests.push({ layerId: 'later', span: { ...structuredClone(f.span), id: 'later-live' } });
    }
    const before = structuredClone(f.p);
    expect(() => create(f.p, requests)).toThrow();
    expect(f.p).toEqual(before);
  });

it('reopens JSON group recipes and observes coherent later endpoint edits without Refresh', () => {
  const f = fixture(),
    out = add(f),
    reopened = migrateProject(JSON.parse(JSON.stringify(out))),
    old = capture(() => ({ project: reopened, revision: 0 }));
  checkWorld(old.sample(4)[0].key.shapes, f, 0.5);
  for (const s of reopened.layers[0].keys[1].shapes.slice(0, 2)) s.x += 20;
  expect(() => old.sample(4)).toThrow(/changed/);
  old.dispose();
  const fresh = sample(reopened);
  expect(fresh[0].x).toBeCloseTo(60, 12);
  expect(fresh[1].x - fresh[0].x).toBeCloseTo(8 / Math.sqrt(2), 10);
  expect(reopened.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
});

it('preserves explicit false/default headers, path/channels and detached updates/removal', () => {
  const f = fixture();
  Object.assign(f.span.rotation!, {
    groupDepth: 0,
    savedGroupPivots: false,
    uniformGroupScale: false,
    axisGroupScale: false,
    axisGroupShear: false,
  });
  f.span.path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  f.span.opacityEase = 'out';
  const out = add(f),
    before = structuredClone(out),
    changed = update(out, [{ layerId: 'track', spanId: 'group-live', changes: { ease: 'in' } }]);
  expect(changed.layers[0].liveMotionSpans![0]).toEqual({ ...f.span, ease: 'in' });
  expect(changed.layers[0].keys).toEqual(out.layers[0].keys);
  const mid = sample(out);
  expect(mid[0].x).toBeCloseTo(50, 12);
  expect(mid[0].y).toBeCloseTo(70, 12);
  expect(mid[1].x - mid[0].x).toBeCloseTo(8 / Math.sqrt(2), 10);
  const removed = remove(out, [{ layerId: 'track', spanId: 'group-live' }]);
  expect(removed.layers[0].liveMotionSpans).toBeUndefined();
  expect(removed.layers[0].keys).toEqual(f.p.layers[0].keys);
  changed.layers[0].keys[0].shapes[0].x = 999;
  expect(out).toEqual(before);
});

it('keeps legacy split/cubic/creation authority restricted to plain roots', () => {
  const f = fixture();
  f.span.path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  const out = add(f);
  const split = captureLiveMotionAuthoringFrame(() => ({ project: out, revision: 0, frame: 4 }));
  expect(split.scene[0].key.shapes).toHaveLength(3);
  expect(split.choices).toEqual([]);
  expect(() => split.resolve('track', 'a0')).toThrow();
  split.dispose();
  const curve = captureLiveCubicControls(() => ({ project: out, revision: 0, frame: 4 }));
  expect(curve.choices).toEqual([]);
  expect(() => curve.resolve('track', 'group-live', 'a0', 'start')).toThrow();
  curve.dispose();
  expect(() =>
    splitLiveMotionLayer(out, out.layers[0], out.layers[0].liveMotionSpans![0], 4, 'right'),
  ).toThrow(/group/);
  expect(liveCreationIssue(f.p, 'track', 0, 8)).toMatch(/group/i);
});

it('removes a structurally valid failed group recipe without sampling geometry', () => {
  const f = fixture(),
    out = add(f);
  out.layers[0].keys[1].shapes[1].x += 3;
  validateProject(out);
  expect(() => sample(out)).toThrow();
  const result = remove(out, [{ layerId: 'track', spanId: 'group-live' }]);
  expect(result.layers[0].liveMotionSpans).toBeUndefined();
  expect(result.layers[0].keys).toEqual(out.layers[0].keys);
});

for (const phase of ['source', 'request', 'clone', 'enclosing', 'reentry'] as const)
  it(`rejects group ${phase} changes without partial candidate publication`, () => {
    const f = fixture(),
      before = structuredClone(f.p),
      requests = [{ layerId: 'track', span: f.span }];
    let hit = false;
    const options = {
      validate: () => {
        if (phase === 'enclosing' && !hit) {
          hit = true;
          throw Error('enclosing changed');
        }
        if (phase === 'reentry' && !hit) {
          hit = true;
          try {
            create(f.p, requests);
          } catch {
            /* swallowed */
          }
        }
      },
    };
    if (phase === 'source' || phase === 'request' || phase === 'clone') {
      const clone = structuredClone;
      vi.spyOn(globalThis, 'structuredClone').mockImplementation((value) => {
        const out = clone(value);
        const p = value as Project;
        if (!hit && p?.layers?.[0]?.liveMotionSpans?.[0]?.rotation?.rigidGroups) {
          hit = true;
          if (phase === 'source') f.p.layers[0].name = 'Separate edit';
          if (phase === 'request') f.span.ease = 'out';
          if (phase === 'clone') (out as Project).layers[0].keys[0].shapes[0].x++;
        }
        return out;
      });
    }
    expect(() => create(f.p, requests, options)).toThrow();
    expect(hit).toBe(true);
    expect(f.p).toEqual(
      phase === 'source'
        ? { ...before, layers: [{ ...before.layers[0], name: 'Separate edit' }] }
        : before,
    );
  });

it('rejects raw group hierarchy getters and nonfinite bases before transport', () => {
  for (const mode of ['getter', 'nan']) {
    const f = fixture();
    let reads = 0;
    if (mode === 'getter')
      Object.defineProperty(f.p.layers[0].keys[1].shapes[1], 'groups', {
        enumerable: true,
        get() {
          reads++;
          return ['outer0', 'inner0'];
        },
      });
    else f.p.layers[0].keys[1].shapes[0].transform![0] = NaN;
    const clone = vi.spyOn(globalThis, 'structuredClone');
    expect(() => add(f)).toThrow();
    expect(reads).toBe(0);
    expect(clone).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  }
});

it('admits the original aggregate artwork capacity and rejects overflow without lower group caps', () => {
  const f = fixture(),
    art: Vector = {
      id: 'art',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
  f.p.symbols = [
    {
      id: 'library',
      name: 'Library',
      width: 100,
      height: 100,
      shapes: Array.from({ length: MAX_SYMBOL_ARTWORK }, (_, i) => ({
        ...art,
        id: 's' + i,
        points: [],
      })),
    },
  ];
  const out = add(f);
  expect(out.symbols![0].shapes).toHaveLength(MAX_SYMBOL_ARTWORK);
  expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
  f.p.symbols[0].shapes.push({ ...art, id: 'over' });
  expect(() => add(f)).toThrow(/budget|limit|artwork/i);
}, 30000);

it('new readonly group samples agree with the shared sampler without relying on it as a world oracle', () => {
  const f = fixture('both-shears', 'reflected', 2),
    out = add(f),
    sampler = createMotionFrameSampler(out, 'track', f.span);
  const view = capture(() => ({ project: out, revision: 0 }));
  for (let at = 0; at <= 8; at++) expect(view.sample(at)[0].key.shapes).toEqual(sampler.sample(at));
  sampler.dispose();
  view.dispose();
});

for (const direction of ['clockwise', 'counterclockwise'] as const)
  it(`retains explicit ${direction} full turns without rewriting endpoint rotation metadata`, () => {
    const f = fixture('rigid', 'reflected', 2);
    f.span.rotation!.direction = direction;
    f.span.rotation!.turns = 1;
    const out = add(f);
    for (const at of [1, 2, 4, 6, 7]) checkWorld(sample(out, at), f, at / 8);
    expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
  });

it('applies explicit geometry ease independently to group motion without materializing keys', () => {
  const f = fixture('shear', 'affine', 2);
  f.span.ease = { kind: 'cubic', x1: 0, y1: 0, x2: 1, y2: 0 };
  const out = add(f);
  checkWorld(sample(out), f, 0.125);
  expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
});

function replaceGroupTransform(f: ReturnType<typeof fixture>, h: Basis) {
  const [first, last] = f.p.layers[0].keys;
  f.h = h;
  for (let i = 0; i < f.groups * 2; i++) {
    const s = first.shapes[i],
      leader = first.shapes[Math.floor(i / 2) * 2],
      r = rotation(i < 2 ? 90 : -90);
    const dx = s.x - leader.x,
      dy = s.y - leader.y,
      x = h[0] * dx + h[2] * dy,
      y = h[1] * dx + h[3] * dy;
    last.shapes[i].x = leader.x + 80 * f.unit + r[0] * x + r[2] * y;
    last.shapes[i].y = leader.y + 40 * f.unit + r[1] * x + r[3] * y;
    last.shapes[i].transform = mul(mul(mul(rotation(-s.rotation), h), rotation(s.rotation)), f.m);
  }
}
it('rejects positive-endpoint determinant whose shared group path collapses in the interior', () => {
  const f = fixture('both-shears');
  replaceGroupTransform(f, [-2, 1, 1, -2]);
  // det(H)=3, while det((1-t)I+tH) has roots at1/4 and1/2.
  expect(f.h[0] * f.h[3] - f.h[1] * f.h[2]).toBe(3);
  const before = structuredClone(f.p);
  expect(() => add(f)).toThrow(/orientation|collapse/);
  expect(f.p).toEqual(before);
});
it('admits an existing orientation-preserving two-axis group path with negative diagonal components', () => {
  const f = fixture('both-shears', 'reflected', 2);
  replaceGroupTransform(f, [-2, 1, -1, -2]);
  const out = add(f);
  for (const at of [1, 2, 4, 6, 7]) checkWorld(sample(out, at), f, at / 8);
});

for (const mode of ['locked', 'hidden'] as const)
  it(`keeps ${mode} group authoring blocked while readonly sampling retains original visibility`, () => {
    const f = fixture();
    if (mode === 'locked') f.p.layers[0].locked = true;
    else f.p.layers[0].visible = false;
    const before = structuredClone(f.p);
    expect(() => add(f)).toThrow();
    expect(f.p).toEqual(before);
    const valid = fixture(),
      out = add(valid);
    if (mode === 'locked') out.layers[0].locked = true;
    else out.layers[0].visible = false;
    const v = capture(() => ({ project: out, revision: 0 }));
    const rows = v.sample(4);
    if (mode === 'hidden') expect(rows).toEqual([]);
    else checkWorld(rows[0].key.shapes, valid, 0.5);
    v.dispose();
  });

for (const defaults of [false, true])
  it(`keeps explicit ${defaults ? 'mixed default' : 'saved'} local pivots separate from unsupported group orbit pivots`, () => {
    const f = fixture();
    f.span.options = { pivots: true, ...(defaults ? { defaultPivots: true } : {}) };
    if (defaults) delete f.p.layers[0].keys[0].shapes[0].pivot;
    for (const s of f.p.layers[0].keys[1].shapes) s.pivot = { x: 8, y: -2 };
    const out = add(f),
      mid = sample(out);
    expect(mid[0].pivot!.x).toBeCloseTo(defaults ? 6.5 : 5.5, 12);
    expect(mid[0].pivot!.y).toBeCloseTo(1, 12);
    expect(mid[1].pivot).toEqual({ x: 5.5, y: 1 });
    expect(mid[0].x).toBe(50);
    expect(mid[0].y).toBe(40);
    expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
    if (defaults) expect(Object.hasOwn(out.layers[0].keys[0].shapes[0], 'pivot')).toBe(false);
  });

it('prepares multiple complete group tracks atomically with independent detached outputs', () => {
  const f = fixture(),
    later = structuredClone(f.p.layers[0]);
  later.id = 'later';
  f.p.layers.push(later);
  const before = structuredClone(f.p),
    out = create(f.p, [
      { layerId: 'track', span: f.span },
      { layerId: 'later', span: { ...structuredClone(f.span), id: 'later-live' } },
    ]);
  const v = capture(() => ({ project: out, revision: 0 }));
  const rows = v.sample(4);
  expect(rows.map((r) => r.layerId)).toEqual(['track', 'later']);
  for (const row of rows) checkWorld(row.key.shapes, f, 0.5);
  rows[1].key.shapes[0].x = 999;
  expect(v.sample(4)[1].key.shapes[0].x).toBe(50);
  expect(f.p).toEqual(before);
  v.dispose();
});

it('retains every member of a large original group without a new group-size cap or generated key expansion', () => {
  const f = fixture(),
    [first, last] = f.p.layers[0].keys,
    donor = structuredClone(first.shapes[0]);
  const a: Vector[] = [],
    b: Vector[] = [];
  for (let i = 0; i < 2000; i++) {
    const x = 10 + i * 0.1,
      y = 20 + (i % 3) * 0.2;
    a.push({ ...structuredClone(donor), id: 'member' + i, x, y });
    b.push({
      ...structuredClone(donor),
      id: 'member' + i,
      x: 90 - (y - 20),
      y: 60 + (x - 10),
      rotation: 90,
    });
  }
  first.shapes = a;
  last.shapes = b;
  const out = add(f),
    mid = sample(out);
  expect(mid).toHaveLength(2000);
  expect(out.layers[0].keys.map((k) => k.frame)).toEqual([0, 8, 10]);
  for (const i of [0, 999, 1999]) {
    const dx = a[i].x - 10,
      dy = a[i].y - 20;
    expect(mid[i].x).toBeCloseTo(50 + (dx - dy) / Math.sqrt(2), 9);
    expect(mid[i].y).toBeCloseTo(40 + (dx + dy) / Math.sqrt(2), 9);
    expect(mid[i].id).toBe('member' + i);
  }
  expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
});

for (const distance of [false, true])
  it(`retains existing path heading composition with distance timing ${distance}`, () => {
    const f = fixture('rigid', 'reflected');
    f.span.path = {
      startX: 40,
      startY: 0,
      endX: -40,
      endY: 0,
      tangent: true,
      distance,
      headingOffset: 0,
      headingOffsetEnd: 0,
    };
    const out = add(f),
      mid = sample(out),
      a = mid[0],
      b = mid[1];
    expect(a.x).toBeCloseTo(50, 9);
    expect(a.y).toBeCloseTo(40, 9);
    // The cubic's midpoint derivative is(60,60), adding45 degrees to the
    // group's45-degree orbit. Its end derivatives are horizontal, preserving
    // the originally authored endpoint rotations exactly.
    expect(b.x).toBeCloseTo(38, 9);
    expect(b.y).toBeCloseTo(60, 9);
    for (let i = 0; i < 2; i++) {
      const expected = mul(rotation(f.p.layers[0].keys[0].shapes[i].rotation + 90), f.m),
        actual = matrix(mid[i]);
      for (let j = 0; j < 4; j++) expect(actual[j]).toBeCloseTo(expected[j], 9);
    }
    expect(out.layers[0].keys).toEqual(f.p.layers[0].keys);
    expect(out.layers[0].liveMotionSpans![0].path).toEqual(f.span.path);
  });

it('mixed sparse projects retain independent plain-root split/cubic authority while excluding group origins', () => {
  const f = fixture();
  f.span.path = { startX: 0, startY: 40, endX: 0, endY: 40 };
  const plain = structuredClone(f.p.layers[0]);
  plain.id = 'plain';
  for (const key of plain.keys) for (const s of key.shapes) delete s.groups;
  plain.keys[1].shapes = plain.keys[0].shapes.map((s) => ({
    ...structuredClone(s),
    x: s.x + 80,
    y: s.y + 40,
    rotation: s.rotation + 90,
  }));
  f.p.layers.push(plain);
  expect(liveCreationIssue(f.p, 'plain', 0, 8)).toBeUndefined();
  const out = create(f.p, [
    { layerId: 'track', span: f.span },
    {
      layerId: 'plain',
      span: { ...structuredClone(f.span), id: 'plain-live', rotation: undefined },
    },
  ]);
  const before = structuredClone(out),
    source = () => ({ project: out, revision: 0, frame: 4 });
  const split = captureLiveMotionAuthoringFrame(source);
  expect(new Set(split.choices.map((c) => c.layerId))).toEqual(new Set(['plain']));
  expect(() => split.resolve('track', 'a0')).toThrow();
  const splitOut = prepareSplitLiveMotionSpans([
    { owner: split.resolve('plain', 'a0'), rightSpanId: 'right' },
  ]);
  expect(splitOut.layers[0]).toEqual(before.layers[0]);
  expect(splitOut.layers[1].keys.map((k) => k.frame)).toEqual([0, 4, 8, 10]);
  split.dispose();
  const curves = captureLiveCubicControls(source);
  expect(new Set(curves.choices.map((c) => c.layerId))).toEqual(new Set(['plain']));
  expect(() => curves.resolve('track', 'group-live', 'a0', 'start')).toThrow();
  const owner = curves.resolve('plain', 'plain-live', 'a0', 'start');
  const changed = prepareLiveCubicControlPositions([
    { owner, target: { x: owner.point.x + 10, y: owner.point.y + 5 } },
  ]);
  expect(changed.layers[0]).toEqual(before.layers[0]);
  expect(changed.layers[1].liveMotionSpans![0].path).toEqual({
    startX: 10,
    startY: 45,
    endX: 0,
    endY: 40,
  });
  expect(out).toEqual(before);
  curves.dispose();
});

for (const mode of ['sparse', 'extra', 'nonenumerable', 'inherited'] as const)
  it(`rejects malformed original ${mode} group ancestry without normalizing it`, () => {
    const f = fixture(),
      out = add(f);
    for (const key of out.layers[0].keys.slice(0, 2))
      for (const shape of key.shapes.slice(0, 2)) {
        if (mode === 'sparse') {
          const a = Array<string>(3);
          a[0] = 'outer0';
          a[2] = 'inner0';
          shape.groups = a;
        }
        if (mode === 'extra') Object.assign(shape.groups!, { forged: 'extra' });
        if (mode === 'nonenumerable')
          Object.defineProperty(shape.groups!, '1', { value: 'inner0', enumerable: false });
        if (mode === 'inherited') {
          const a = shape.groups;
          delete shape.groups;
          Object.setPrototypeOf(shape, { groups: a });
        }
      }
    expect(() => validateProject(out)).toThrow(/dense|fields|ancestry/i);
    if (mode === 'sparse')
      expect(Object.hasOwn(out.layers[0].keys[0].shapes[0].groups!, '1')).toBe(false);
  });

for (const mode of ['groups', 'keys', 'outside'] as const)
  it(`document group validation rejects original ${mode} getters before reading them`, () => {
    const f = fixture(),
      out = add(f);
    let reads = 0;
    if (mode === 'keys') {
      const keys = out.layers[0].keys;
      Object.defineProperty(out.layers[0], 'keys', {
        enumerable: true,
        get() {
          reads++;
          return keys;
        },
      });
    }
    if (mode === 'groups')
      Object.defineProperty(out.layers[0].keys[0].shapes[0], 'groups', {
        enumerable: true,
        get() {
          reads++;
          return ['outer0', 'inner0'];
        },
      });
    if (mode === 'outside') {
      out.layers[0].keys[2].shapes = [structuredClone(out.layers[0].keys[0].shapes[0])];
      Object.defineProperty(out.layers[0].keys[2].shapes[0], 'x', {
        enumerable: true,
        get() {
          reads++;
          return 1;
        },
      });
    }
    expect(() => validateProject(out)).toThrow(/data|accessor/i);
    expect(reads).toBe(0);
  });

it('rejects custom ancestry iterators before they can reinterpret original membership', () => {
  const out = add(fixture());
  let reads = 0;
  const ancestry = out.layers[0].keys[0].shapes[0].groups!;
  Object.setPrototypeOf(
    ancestry,
    Object.create(Array.prototype, {
      [Symbol.iterator]: {
        get() {
          reads++;
          throw Error('must not iterate');
        },
      },
    }),
  );
  expect(() => validateProject(out)).toThrow(/original array/);
  expect(reads).toBe(0);
});
