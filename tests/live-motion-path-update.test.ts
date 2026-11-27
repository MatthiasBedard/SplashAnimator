import { expect, it, vi } from 'vitest';
import { movieLayerView, newProject, validateProject, type Project, type Vector } from '../packages/document/src';
import type { MotionPath } from '../packages/document/src/motion-path';
import {
  prepareUpdateLiveMotionSpans as update,
  prepareRemoveLiveMotionSpans as remove,
  captureLiveMotionTimeline as capture,
  type UpdateLiveMotionRequest,
} from '../packages/animation/src/live-motion';
import {
  captureLiveMotionAuthoringFrame,
  prepareSplitLiveMotionSpans,
} from '../packages/animation/src/live-motion-owner';
import { prepareTimelineKeyframe } from '../apps/editor/src/timeline-keyframe';
import { transferFrameBlock } from '../packages/animation/src/timeline';
import { prepareLiveHTMLTimeline } from '../packages/export-web/src/live-timeline';
import { matrix, mapPoint } from '../packages/geometry/src/affine';

function fixture(two = false): Project {
  const p = newProject();
  p.duration = 10;
  p.layers[0].id = 'track';
  const a: Vector = {
    id: 'art',
    kind: 'rectangle',
    x: 10,
    y: 20,
    width: 20,
    height: 20,
    rotation: 0,
    opacity: 0.2,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  p.layers[0].keys = [
    { frame: 0, shapes: [a] },
    { frame: 8, shapes: [{ ...structuredClone(a), x: 90, y: 60, opacity: 1, fill: '#808080' }] },
    { frame: 9, shapes: [] },
  ];
  p.layers[0].liveMotionSpans = [
    {
      id: 'live',
      start: 0,
      end: 8,
      ease: 'linear',
      opacityEase: 'out',
      paintEase: 'linear',
      options: { paint: true },
    },
  ];
  if (two) p.layers.push({ ...structuredClone(p.layers[0]), id: 'later' });
  return p;
}
const req = (path: MotionPath | undefined, layerId = 'track'): UpdateLiveMotionRequest => ({
  layerId,
  spanId: 'live',
  changes: { path },
});
const arch: MotionPath = { startX: 0, startY: 80, endX: 0, endY: 80 };
function sample(p: Project, f = 4) {
  const c = capture(() => ({ project: p, revision: 0 }));
  try {
    return c.sample(f)[0].key.shapes[0];
  } finally {
    c.dispose();
  }
}
type P = { x: number; y: number };
function cubic(a: P, b: P, c: P, d: P, t: number): P {
  return {
    x: (1 - t) ** 3 * a.x + 3 * (1 - t) ** 2 * t * b.x + 3 * (1 - t) * t * t * c.x + t ** 3 * d.x,
    y: (1 - t) ** 3 * a.y + 3 * (1 - t) ** 2 * t * b.y + 3 * (1 - t) * t * t * c.y + t ** 3 * d.y,
  };
}
const controls = [
  { x: 10, y: 20 },
  { x: 10, y: 100 },
  { x: 90, y: 140 },
  { x: 90, y: 60 },
] as const;

for (const ease of ['linear', 'in', 'out'] as const)
  it(`replaces a cubic with independent analytic ${ease} poses and unchanged channels/endpoints`, () => {
    const p = fixture();
    p.layers[0].liveMotionSpans![0].ease = ease;
    const before = structuredClone(p),
      request = req(arch),
      out = update(p, [request]),
      expected = structuredClone(p);
    expected.layers[0].liveMotionSpans![0].path = { ...arch };
    expect(out).toEqual(expected);
    expect(p).toEqual(before);
    expect(request).toEqual(req(arch));
    for (const f of [1, 2, 4, 6, 7]) {
      const raw = f / 8,
        t = ease === 'in' ? raw * raw : ease === 'out' ? 1 - (1 - raw) ** 2 : raw,
        want = cubic(...controls, t),
        mid = sample(out, f);
      expect(mid.x).toBeCloseTo(want.x, 12);
      expect(mid.y).toBeCloseTo(want.y, 12);
    }
    expect(sample(out).opacity).toBeCloseTo(0.8);
    expect(sample(out).fill).toBe('#404040');
    expect(sample(out, 0)).toEqual(before.layers[0].keys[0].shapes[0]);
    expect(sample(out, 8)).toEqual(before.layers[0].keys[1].shapes[0]);
    expect(validateProject(JSON.parse(JSON.stringify(out)))).toEqual(out);
    expect(out.layers[0].keys).toHaveLength(3);
  });

for (const distance of [false, true])
  it(`straight waypoint ${distance ? 'distance' : 'equal-segment'} timing follows independent lengths`, () => {
    const out = update(fixture(), [
      req({ startX: 0, startY: 0, endX: 0, endY: 0, waypoints: [{ x: 0, y: 40 }], distance }),
    ]);
    const expected = distance
      ? [
          [10, 50],
          [30, 60],
          [60, 60],
        ]
      : [
          [10, 40],
          [10, 60],
          [50, 60],
        ];
    for (const [i, f] of [2, 4, 6].entries()) {
      const s = sample(out, f);
      expect(s.x).toBeCloseTo(expected[i][0], 12);
      expect(s.y).toBeCloseTo(expected[i][1], 12);
    }
  });

it('curved waypoint defaults retain the independently derived Catmull-Rom pose', () => {
  const out = update(fixture(), [
    req({
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      waypoints: [{ x: 0, y: 40 }],
      curvedWaypoints: true,
    }),
  ]);
  expect(sample(out, 2).x).toBeCloseTo(5, 12);
  expect(sample(out, 2).y).toBeCloseTo(40, 12);
  expect(sample(out, 4).x).toBe(10);
  expect(sample(out, 4).y).toBe(60);
  expect(sample(out, 6).x).toBeCloseTo(50, 12);
  expect(sample(out, 6).y).toBeCloseTo(62.5, 12);
});

it('explicit independent incoming/outgoing waypoint controls remain exact', () => {
  const path: MotionPath = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    waypoints: [{ x: 0, y: 40 }],
    curvedWaypoints: true,
    waypointTangents: [
      { x: 0, y: 20 },
      { x: 20, y: 0 },
      { x: 20, y: 0 },
    ],
    waypointIncoming: [{ x: -10, y: 0 }],
  };
  const out = update(fixture(), [req(path)]);
  expect(out.layers[0].liveMotionSpans![0].path).toEqual(path);
  expect(sample(out, 2).x).toBeCloseTo(6.25, 12);
  expect(sample(out, 2).y).toBeCloseTo(47.5, 12);
  expect(sample(out, 6).x).toBeCloseTo(50, 12);
  expect(sample(out, 6).y).toBeCloseTo(60, 12);
});

it('distance cubic positions agree with fixed-panel analytic speed quadrature', () => {
  const p = update(fixture(), [req({ ...arch, distance: true })]),
    panels = 16384,
    lengths = [0];
  const speed = (t: number) => {
    const v = controls[0];
    const b = controls[1],
      c = controls[2],
      d = controls[3];
    return Math.hypot(
      ...(['x', 'y'] as const).map(
        (k) =>
          3 *
          ((1 - t) ** 2 * (b[k] - v[k]) + 2 * (1 - t) * t * (c[k] - b[k]) + t * t * (d[k] - c[k])),
      ),
    );
  };
  for (let i = 0; i < panels; i++)
    lengths.push(
      lengths[i] +
        (speed(i / panels) + 4 * speed((i + 0.5) / panels) + speed((i + 1) / panels)) /
          (6 * panels),
    );
  for (const f of [1, 2, 4, 6, 7]) {
    const wanted = (lengths[panels] * f) / 8;
    let hi = 1;
    while (lengths[hi] < wanted) hi++;
    const t = (hi - 1 + (wanted - lengths[hi - 1]) / (lengths[hi] - lengths[hi - 1])) / panels,
      want = cubic(...controls, t),
      actual = sample(p, f);
    expect(Math.hypot(actual.x - want.x, actual.y - want.y)).toBeLessThan(0.003);
  }
});

it('tangent heading and explicit correction use the existing progress domain without changing endpoints', () => {
  const out = update(fixture(), [
    req({ ...arch, tangent: true, headingOffset: 10, headingOffsetEnd: 20 }),
  ]);
  expect(sample(out).rotation).toBeCloseTo((Math.atan2(60, 120) * 180) / Math.PI + 15, 10);
  expect(sample(out, 0).rotation).toBe(0);
  expect(sample(out, 8).rotation).toBe(0);
});

for (const reflected of [false, true])
  it(`trajectory uses original document origins with ${reflected ? 'reflected' : 'affine'} compound geometry and saved pivots`, () => {
    const p = fixture();
    for (const k of p.layers[0].keys.slice(0, 2))
      Object.assign(k.shapes[0], {
        kind: 'polygon',
        fillRule: 'evenodd',
        transform: [reflected ? -2 : 2, 0.25, 0.5, 3],
        rotation: 30,
        pivot: { x: -200, y: 300 },
        contours: [
          [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 20 },
            { x: 0, y: 20 },
          ],
          [
            { x: 4, y: 4 },
            { x: 10, y: 4 },
            { x: 7, y: 10 },
          ],
        ],
      });
    p.layers[0].liveMotionSpans![0].options = { paint: true, affine: true, nodes: true };
    const before = structuredClone(p),
      out = update(p, [req(arch)]),
      mid = sample(out),
      want = cubic(...controls, 0.5),
      basis = matrix({ ...p.layers[0].keys[0].shapes[0], ...want });
    for (const ring of mid.contours!)
      for (const point of ring) {
        const a = mapPoint(matrix(mid), point),
          b = mapPoint(basis, point);
        expect(a.x).toBeCloseTo(b.x, 11);
        expect(a.y).toBeCloseTo(b.y, 11);
      }
    expect(mid.pivot).toEqual({ x: -200, y: 300 });
    expect(p).toEqual(before);
    expect(out.layers[0].keys).toEqual(before.layers[0].keys);
  });

it('explicit clearing restores linear position, omission preserves the exact saved path, and later endpoint edits need no Refresh', () => {
  const p = update(fixture(), [req(arch)]),
    same = update(p, [{ layerId: 'track', spanId: 'live', changes: { opacityEase: 'in' } }]);
  expect(same.layers[0].liveMotionSpans![0].path).toEqual(arch);
  const out = update(p, [req(undefined)]);
  expect(Object.hasOwn(out.layers[0].liveMotionSpans![0], 'path')).toBe(false);
  expect(sample(out).x).toBe(50);
  expect(sample(out).y).toBe(40);
  const old = capture(() => ({ project: p, revision: 0 }));
  p.layers[0].keys[1].shapes[0].x = 130;
  expect(() => old.sample(4)).toThrow();
  old.dispose();
  expect(sample(p).x).toBe(70);
  expect(sample(p).y).toBe(100);
});

it('updated cubic still admits an exact sparse preserved junction without baking', () => {
  const p = update(fixture(), [req(arch)]),
    view = captureLiveMotionAuthoringFrame(() => ({ project: p, revision: 0, frame: 4 }));
  const split = prepareSplitLiveMotionSpans([
    { owner: view.resolve('track', 'art'), rightSpanId: 'right' },
  ]);
  view.dispose();
  expect(split.layers[0].keys.map((k) => k.frame)).toEqual([0, 4, 8, 9]);
  for (let f = 0; f <= 8; f++) {
    const a = sample(p, f),
      b = sample(split, f);
    expect(b.x).toBeCloseTo(a.x, 11);
    expect(b.y).toBeCloseTo(a.y, 11);
    expect(b.opacity).toBeCloseTo(a.opacity!, 11);
    expect(b.fill).toBe(a.fill);
  }
});

for (const path of [
  null,
  {},
  { ...arch, startX: NaN },
  { ...arch, endY: Infinity },
  { ...arch, extra: true },
  { ...arch, waypoints: [] },
  { ...arch, waypoints: [{ x: 1, y: 2, extra: 3 }] },
  { ...arch, waypoints: [,] },
  { ...arch, distance: 'yes' },
  { ...arch, curvedWaypoints: true },
  { ...arch, headingOffset: 1 },
  { ...arch, headingOffsetEnd: 1 },
  { ...arch, waypointTangents: [{ x: 1, y: 2 }] },
  { ...arch, waypoints: [{ x: 1, y: 2 }], waypointIncoming: [{ x: 1, y: 2 }] },
])
  it(`rejects original malformed path ${JSON.stringify(path)} before transport`, () => {
    const p = fixture(),
      before = structuredClone(p),
      clone = structuredClone;
    let calls = 0;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      calls++;
      return clone(v);
    });
    try {
      expect(() => update(p, [req(path as MotionPath)])).toThrow();
      expect(calls).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(p).toEqual(before);
  });

for (const place of ['path', 'point', 'prototype', 'nonenumerable', 'arrayExtra', 'arrayPrototype'])
  it(`raw ${place} path data cannot run getters or vanish in a clone`, () => {
    const p = fixture(),
      path: MotionPath = { ...arch, waypoints: [{ x: 0, y: 40 }] };
    let reads = 0;
    if (place === 'path')
      Object.defineProperty(path, 'startX', {
        enumerable: true,
        get() {
          reads++;
          return 0;
        },
      });
    if (place === 'point')
      Object.defineProperty(path.waypoints![0], 'x', {
        enumerable: true,
        get() {
          reads++;
          return 0;
        },
      });
    if (place === 'prototype')
      Object.setPrototypeOf(path, {
        get distance() {
          reads++;
          return false;
        },
      });
    if (place === 'nonenumerable')
      Object.defineProperty(path, 'extra', { enumerable: false, value: true });
    if (place === 'arrayExtra') Object.assign(path.waypoints!, { extra: true });
    if (place === 'arrayPrototype') {
      const prototype = Object.create(Array.prototype);
      Object.defineProperty(prototype, Symbol.iterator, {
        get() {
          reads++;
          return Array.prototype[Symbol.iterator];
        },
      });
      Object.setPrototypeOf(path.waypoints!, prototype);
    }
    expect(() => update(p, [req(path)])).toThrow();
    expect(reads).toBe(0);
  });

for (const mode of ['missing', 'duplicate', 'locked', 'hidden', 'stationary', 'overflow'])
  it(`later ${mode} path request rejects every update without consuming original records`, () => {
    const p = fixture(true),
      requests = [req(arch), req(arch, 'later')];
    if (mode === 'missing') requests[1].spanId = 'missing';
    if (mode === 'duplicate') requests[1] = structuredClone(requests[0]);
    if (mode === 'locked') p.layers[1].locked = true;
    if (mode === 'hidden') p.layers[1].visible = false;
    if (mode === 'stationary')
      requests[1].changes.path = { startX: 40, startY: 20, endX: -120, endY: -60, tangent: true };
    if (mode === 'overflow')
      requests[1].changes.path = {
        startX: Number.MAX_VALUE,
        startY: 0,
        endX: -Number.MAX_VALUE,
        endY: 0,
        distance: true,
      };
    const before = structuredClone(p);
    expect(() => update(p, requests)).toThrow();
    expect(p).toEqual(before);
    expect(update(p, [requests[0]]).layers[1]).toEqual(before.layers[1]);
  });

for (const mode of ['source', 'input', 'revision', 'reentry', 'async'])
  it(`path ${mode} admission rejects stale preparation and supports valid retries`, () => {
    const p = fixture(),
      requests = [req({ ...arch })],
      before = structuredClone(p);
    let once = true;
    expect(() =>
      update(p, requests, {
        validate: () => {
          if (!once) return;
          once = false;
          if (mode === 'source') p.name = 'Independent edit';
          if (mode === 'input') requests[0].changes.path!.startY = 10;
          if (mode === 'revision') {
            p.name = 'temporary';
            p.name = before.name;
            throw Error('Enclosing revision changed.');
          }
          if (mode === 'reentry') {
            try {
              update(p, requests);
            } catch {
              /* swallowed reentry remains invalid */
            }
          }
          if (mode === 'async') return Promise.resolve() as unknown as void;
        },
      }),
    ).toThrow();
    expect(p.layers).toEqual(before.layers);
    expect(update(p, [req(arch)]).layers[0].liveMotionSpans![0].path).toEqual(arch);
  });

for (const mode of ['requestClone', 'outputClone', 'lateSource', 'lateCandidate'])
  it(`asserted ${mode} path corruption rejects without publishing detached geometry`, () => {
    const p = fixture(),
      before = structuredClone(p),
      clone = structuredClone;
    let candidate: Project | undefined,
      hit = false;
    vi.stubGlobal('structuredClone', (value: unknown) => {
      const out = clone(value),
        q = out as Project;
      if (value === p) candidate = q;
      if (!hit && mode === 'requestClone' && Array.isArray(out) && out[0]?.changes) {
        hit = true;
        out[0].changes.path.startY = 10;
      }
      if (!hit && q?.layers?.[0]?.liveMotionSpans?.[0]?.path) {
        hit = true;
        if (mode === 'outputClone') q.layers[0].liveMotionSpans![0].path!.startY = 10;
        if (mode === 'lateSource') p.name = 'Independent edit';
        if (mode === 'lateCandidate') candidate!.layers[0].liveMotionSpans![0].path!.startY = 10;
      }
      return out;
    });
    try {
      expect(() => update(p, [req(arch)])).toThrow();
      expect(hit).toBe(true);
      expect(p.layers).toEqual(before.layers);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(update(p, [req(arch)]).layers[0].liveMotionSpans![0].path).toEqual(arch);
  });

it('sparse duration stays sparse and invalid paths retain geometry-free removal recovery', () => {
  const p = fixture();
  p.duration = 100000;
  p.layers[0].keys = p.layers[0].keys.slice(0, 2);
  p.layers[0].keys[1].frame = 99999;
  p.layers[0].liveMotionSpans![0].end = 99999;
  const out = update(p, [req(arch)]);
  expect(out.layers[0].keys).toHaveLength(2);
  expect(Number.isFinite(sample(out, 50000).x)).toBe(true);
  out.layers[0].liveMotionSpans![0].path = {
    startX: 40,
    startY: 20,
    endX: -120,
    endY: -60,
    tangent: true,
  };
  expect(() => sample(out, 50000)).toThrow();
  const recovered = remove(out, [{ layerId: 'track', spanId: 'live' }]);
  expect(recovered.layers[0].keys).toEqual(out.layers[0].keys);
  expect(recovered.layers[0].liveMotionSpans).toBeUndefined();
});

it('distance-timed curved waypoints retain analytic distance on a collinear route', () => {
  const p = update(fixture(), [
    req({
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0,
      waypoints: [{ x: 40, y: 20 }],
      curvedWaypoints: true,
      distance: true,
    }),
  ]);
  for (const f of [1, 2, 3, 4, 5, 6, 7]) {
    const a = sample(p, f);
    expect(Math.abs(a.x - (10 + (80 * f) / 8))).toBeLessThan(0.003);
    expect(Math.abs(a.y - (20 + (40 * f) / 8))).toBeLessThan(0.003);
  }
});

it('authored outside holds and blank keys retain their exact frame origin after path changes', () => {
  const p = fixture();
  p.duration = 12;
  p.layers[0].keys[2].frame = 10;
  const before = structuredClone(p),
    out = update(p, [req(arch)]);
  const c = capture(() => ({ project: out, revision: 0 }));
  try {
    expect(c.sample(9)[0].key).toEqual(before.layers[0].keys[1]);
    expect(c.sample(10)[0].key).toEqual(before.layers[0].keys[2]);
  } finally {
    c.dispose();
  }
  expect(out.layers[0].keys).toEqual(before.layers[0].keys);
});

it('exports the current linked guide across reload and rejects missing or competing sources atomically', () => {
  const p=fixture(), source=p.layers[0].keys[0].shapes[0];
  p.layers.push({id:'route',name:'Route',visible:false,locked:false,keys:[{frame:0,shapes:[
    {...source,id:'guide',kind:'path',points:[{x:0,y:0},{x:40,y:60},{x:80,y:40}],closed:false}
  ]}]});
  const guide={layerId:'route',frame:0,shapeId:'guide'};
  const linked=update(p,[{layerId:'track',spanId:'live',changes:{guide}}]);
  expect(sample(linked)).toMatchObject({x:50,y:80});
  const changed=structuredClone(linked);
  changed.layers[1].keys[0].shapes[0].points[1].y=30;
  const saved=JSON.stringify(changed);
  const recovered=validateProject(JSON.parse(saved));
  expect(sample(recovered)).toMatchObject({x:50,y:50});
  const exported=prepareLiveHTMLTimeline(recovered);
  expect(exported.layers[0].keys.find(k=>k.frame===4)!.shapes[0]).toMatchObject({x:50,y:50});
  expect(JSON.stringify(recovered)).toBe(saved);
  expect(()=>update(recovered,[req(arch)])).toThrow(/guide/i);
  for(const invalid of [{...guide,frame:1},{...guide,shapeId:'missing'},{...guide,layerId:'track'}])
    expect(()=>update(recovered,[{layerId:'track',spanId:'live',changes:{guide:invalid}}])).toThrow(/guide/i);
  const readGuide=vi.fn(()=>guide.shapeId);
  const malformed=Object.defineProperty({...guide},'shapeId',{get:readGuide});
  expect(()=>update(recovered,[{layerId:'track',spanId:'live',changes:{guide:malformed}}])).toThrow();
  expect(readGuide).not.toHaveBeenCalled();
  const detached=update(recovered,[{layerId:'track',spanId:'live',changes:{guide:undefined,path:arch}}]);
  expect(detached.layers[0].liveMotionSpans![0].guide).toBeUndefined();
  expect(JSON.stringify(recovered)).toBe(saved);
});

it('requires matching offset endpoints, original finite offset data and a single heading owner', () => {
  const p=fixture(), source=p.layers[0].keys[0].shapes[0];
  p.layers.push({id:'route',name:'Route',visible:false,locked:false,keys:[{frame:0,shapes:[
    {...source,id:'guide',kind:'path',x:2,y:32,points:[{x:0,y:0},{x:40,y:60},{x:80,y:40}],closed:false}
  ]}]});
  const guide={layerId:'route',frame:0,shapeId:'guide',offset:{x:8,y:-12},tangent:true as const};
  const changes={layerId:'track',spanId:'live',changes:{guide}};
  const linked=update(p,[changes]);
  expect(sample(linked)).toMatchObject({x:50,y:80});
  expect(sample(linked).rotation).toBeCloseTo(Math.atan2(-20,40)*180/Math.PI);
  expect(()=>update(linked,[{...changes,changes:{rotationKeys:[{offset:4,value:0}]}}])).toThrow(/tangent/i);
  for (const offset of [{x:9,y:-12},{x:8,y:NaN},{x:8,y:Infinity}])
    expect(()=>update(p,[{...changes,changes:{guide:{...guide,offset}}}])).toThrow();
  expect(p.layers[0].liveMotionSpans![0].guide).toBeUndefined();
  expect(linked.layers[0].keys).toEqual(p.layers[0].keys);
});

it('validates original guide roles and retains authoring visibility and artwork in the movie view', () => {
  const p=fixture(true);
  p.layers[1].guideLayer=true;
  const saved=validateProject(p);
  const movie=movieLayerView(saved);
  expect(movie.layers[1].visible).toBe(false);
  expect(movie.layers[1].keys).toBe(saved.layers[1].keys);
  expect(saved).toEqual(p);
  expect(movieLayerView(movie)).toBe(movie);
  expect(()=>validateProject({...p,layerMasks:[{maskLayerId:'later',layerIds:['track']}]})).toThrow(/guide/);
  const getter=vi.fn(()=>true);
  Object.defineProperty(p.layers[1],'guideLayer',{get:getter});
  expect(()=>validateProject(p)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});

it('F6 composes eased guide intervals and preserves tangent, offset and authored junctions', () => {
  const p=fixture();
  const endpoints=p.layers[0].keys;
  const source=endpoints[0].shapes[0];
  endpoints[1].shapes[0].fill=source.fill;
  p.layers.push({id:'route',name:'Guide',visible:false,locked:false,keys:[{frame:0,shapes:[
    {...source,id:'guide',kind:'path',x:2,y:32,points:[{x:0,y:0},{x:30,y:60},{x:80,y:40}],closed:false}
  ]}]});
  const guide={layerId:'route',frame:0,shapeId:'guide',offset:{x:8,y:-12},tangent:true as const};
  const linked=update(p,[{layerId:'track',spanId:'live',changes:{guide,ease:'in'}}]);
  const first=prepareTimelineKeyframe(linked,'track',4);
  const second=prepareTimelineKeyframe(first,'track',6);
  expect(second.layers[0].liveMotionSpans!.map(s=>s.guide?.interval)).toEqual([
    {start:0,end:0.25},{start:0.25,end:0.5625},{start:0.5625,end:1}]);
  expect(second.layers[0].keys.filter(k=>k.frame!==4 && k.frame!==6)).toEqual(endpoints);
  for(let frame=0;frame<=8;frame++){
    const before=sample(linked,frame),after=sample(second,frame);
    for(const prop of ['x','y','rotation','opacity'] as const) expect(after[prop]).toBeCloseTo(before[prop]!,10);
  }
  for(const range of [{start:0.7,end:0.1},{start:-1,end:0.5},{start:0,end:Infinity}])
    expect(()=>update(linked,[{layerId:'track',spanId:'live',changes:{guide:{...guide,interval:range}}}])).toThrow();
});

it('keeps both guide sections editable on either side of an authored F6 junction', () => {
  const p=fixture(), source=p.layers[0].keys[0].shapes[0];
  p.layers[0].keys[1].shapes[0].fill=source.fill;
  p.layers.push({id:'route',name:'Guide',visible:false,locked:false,keys:[{frame:0,shapes:[
    {...source,id:'guide',kind:'path',points:[{x:0,y:0},{x:20,y:10},{x:40,y:20},{x:60,y:30},{x:80,y:40}]}
  ]}]});
  const guide={layerId:'route',frame:0,shapeId:'guide'};
  const linked=update(p,[{layerId:'track',spanId:'live',changes:{guide}}]);
  const result=prepareTimelineKeyframe(linked,'track',4);
  const authored=structuredClone(result.layers[0].keys);
  const points=result.layers[1].keys[0].shapes[0].points;
  points[1].y=24;
  points[3].y=3;
  expect(sample(result,2)).toMatchObject({x:30,y:44});
  expect(sample(result,6)).toMatchObject({x:70,y:23});
  expect(result.layers[0].keys).toEqual(authored);
  const adjacent=prepareTimelineKeyframe(result,'track',1);
  expect(adjacent.layers[0].keys.map(key=>key.frame)).toEqual([0,1,4,8,9]);
  expect(adjacent.layers[0].liveMotionSpans![0].guide?.interval).toEqual({start:0.125,end:0.5});
});

it('routes the original guide through layer and key moves and rejects overwriting a referenced key', () => {
  const p=fixture(), source=p.layers[0].keys[0].shapes[0];
  const path={...source,id:'guide',kind:'path' as const,points:[{x:0,y:0},{x:40,y:60},{x:80,y:40}]};
  p.layers.push({id:'route',name:'Route',visible:true,locked:false,keys:[
    {frame:0,shapes:[path]}, {frame:2,shapes:[structuredClone(path)]}
  ]}, {id:'other',name:'Other',visible:true,locked:false,keys:[{frame:0,shapes:[]}]});
  const guide={layerId:'route',frame:0,shapeId:'guide'};
  const linked=update(p,[{layerId:'track',spanId:'live',changes:{guide}}]);
  const before=structuredClone(linked);
  const move=(sourceId:string,targetId:string,from:number,to:number)=>
    transferFrameBlock(linked,[{sourceId,targetId}],from,from,to);
  expect(()=>move('route','route',2,0)).toThrow(/replace a linked guide/);
  expect(linked).toEqual(before);
  move('route','other',0,4);
  const routed=linked.layers[2].keys[1].shapes[0].id;
  expect(routed).not.toBe('guide');
  expect(linked.layers[0].liveMotionSpans![0].guide).toEqual({layerId:'other',frame:4,shapeId:routed});
  expect(sample(linked)).toEqual(sample(before));
  move('track','track',8,6);
  expect(sample(linked,3)).toEqual(sample(before));
});
