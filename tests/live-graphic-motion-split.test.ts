import { expect, it, vi } from 'vitest';
import { liveGraphicFixture, createLiveGraphics } from './live-graphics-fixture';
import { splitLiveGraphicMotionLayer as split } from '../packages/animation/src/live-graphic-motion-split';
import { splitLiveMotionLayer as rootSplit } from '../packages/animation/src/live-motion-split';
import { splitLiveGroupMotionLayer as groupSplit } from '../packages/animation/src/live-group-motion-split';
import { captureLiveMotionTimeline } from '../packages/animation/src/live-motion';
import { prepareLiveMotionFrameCapture } from '../packages/animation/src/live-motion-presentation';
import { sameMotionArtwork } from '../packages/animation/src/motion-ownership';
import { evaluate } from '../packages/animation/src';
import { mapPoint, matrix } from '../packages/geometry/src/affine';
import { symbolInstance } from '../packages/geometry/src/symbols';
import {
  validateProject,
  MAX_SYMBOL_ARTWORK,
  type Project,
  type Layer,
} from '../packages/document/src';
function fixture(mode = 'loop', basis = 'plain') {
  const { p, span } = liveGraphicFixture(mode, basis);
  return createLiveGraphics(p, span);
}
function operation(p: Project, at = 6, id = 'right') {
  return split(p, p.layers[0], p.layers[0].liveMotionSpans![0], at, id);
}
function projectWith(p: Project, layer: Layer) {
  return { ...p, layers: p.layers.map((l) => (l.id === layer.id ? layer : l)) };
}
async function equivalent(p: Project, out: Project) {
  const a = captureLiveMotionTimeline(() => ({ project: p, revision: 0 })),
    b = captureLiveMotionTimeline(() => ({ project: out, revision: 0 }));
  try {
    for (let f = 0; f < p.duration; f++) {
      expect(
        sameMotionArtwork(a.sample(f)[0].key.shapes, b.sample(f)[0].key.shapes),
        `frame ${f}`,
      ).toBe(true);
      const x = evaluate(
          await prepareLiveMotionFrameCapture(() => ({ project: p, revision: 0 }), f),
          f,
        ),
        y = evaluate(
          await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), f),
          f,
        );
      expect(y.length).toBe(x.length);
      for (let i = 0; i < x.length; i++) {
        const from = mapPoint(matrix(x[i]), { x: 1, y: 1 }),
          to = mapPoint(matrix(y[i]), { x: 1, y: 1 });
        expect(to.x).toBeCloseTo(from.x, 9);
        expect(to.y).toBeCloseTo(from.y, 9);
      }
    }
  } finally {
    a.dispose();
    b.dispose();
  }
}
for (const mode of ['default', 'loop', 'once', 'single'])
  for (const basis of ['plain', 'affine', 'reflected'])
    for (const at of [4, 6, 8])
      it(`restricts ${mode}/${basis} graphics at ${at} without moving clocks or world artwork`, async () => {
        const p = fixture(mode, basis),
          before = structuredClone(p),
          layer = operation(p, at),
          out = projectWith(p, layer);
        validateProject(out);
        expect(p).toEqual(before);
        expect(layer.keys.map((k) => k.frame)).toEqual([0, 2, at, 10, 12]);
        expect(
          layer.liveMotionSpans!.map((s) => [s.id, s.start, s.end, s.symbolContinuity]),
        ).toEqual([
          ['live', 2, at, 'graphics'],
          ['right', at, 10, 'graphics'],
        ]);
        for (const k of before.layers[0].keys)
          expect(layer.keys.find((x) => x.frame === k.frame)).toEqual(k);
        await equivalent(p, out);
        await equivalent(p, JSON.parse(JSON.stringify(out)));
        // Independent oracle, not a comparison only against the original sampler.
        const pose = evaluate(
            await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), 6),
            6,
          )[0],
          clock = mode === 'single' ? 1 : mode === 'once' || mode === 'default' ? 4 : 0,
          b = basis === 'plain' ? [1, 0, 0, 1] : [basis === 'reflected' ? -2 : 2, 0.25, 0.5, 3],
          u = b[0] * (clock * 10 + 1) + b[2],
          v = b[1] * (clock * 10 + 1) + b[3],
          point = mapPoint(matrix(pose), { x: 1, y: 1 });
        expect(point.x).toBeCloseTo(60 + (u - v) / Math.SQRT2, 9);
        expect(point.y).toBeCloseTo(50 + (u + v) / Math.SQRT2, 9);
        layer.keys[1].shapes[0].x++;
        layer.liveMotionSpans![0].ease = 'out';
        expect(p).toEqual(before);
      });
for (const ease of ['in', 'out', 'in-out'] as const)
  for (const at of [4, 8])
    it(`restricts ${ease} graphic geometry independently from clocks at ${at}`, async () => {
      const p = fixture();
      p.layers[0].liveMotionSpans![0].ease = ease;
      if (ease === 'in-out') {
        const before = structuredClone(p);
        expect(() => operation(p, at)).toThrow(/midpoint/);
        expect(p).toEqual(before);
      } else await equivalent(p, projectWith(p, operation(p, at)));
    });
for (const holes of [false, true])
  it(`preserves nested pure graphic exposure/reentry ${holes}`, async () => {
    const { p, span, definition } = liveGraphicFixture(),
      child = {
        ...symbolInstance(definition, 0, 0),
        id: 'child',
        symbolPlayback: { mode: 'once' as const, firstFrame: 2 },
      },
      wrapper = {
        id: 'wrapper',
        name: 'Wrapper',
        width: 60,
        height: 10,
        shapes: [child],
        timeline: {
          duration: 3,
          keys: holes
            ? [
                { frame: 1, shapes: [] },
                { frame: 2, shapes: [structuredClone(child)] },
              ]
            : [],
        },
      };
    p.symbols!.push(wrapper);
    for (const key of p.layers[0].keys) for (const s of key.shapes) s.symbolId = 'wrapper';
    p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 0;
    const source = createLiveGraphics(p, span);
    const out = projectWith(source, operation(source, 4));
    await equivalent(source, out);
    for (let frame = 2; frame < 12; frame++) {
      const phase = (1 + frame - 2) % 3,
        shapes = evaluate(
          await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), frame),
          frame,
        );
      if (holes && phase === 1) {
        expect(shapes).toEqual([]);
        continue;
      }
      const clock = holes ? 2 : Math.min(2 + phase, 4),
        t = Math.min((frame - 2) / 8, 1),
        angle = (t * Math.PI) / 2,
        point = mapPoint(matrix(shapes[0]), { x: 1, y: 1 }),
        x = clock * 10 + 1;
      expect(point.x).toBeCloseTo(20 + 80 * t + Math.cos(angle) * x - Math.sin(angle), 9);
      expect(point.y).toBeCloseTo(30 + 40 * t + Math.sin(angle) * x + Math.cos(angle), 9);
    }
  });
for (const mode of ['loop', 'once', 'single'] as const)
  it(`preserves high authored ${mode} offsets after clamped split`, async () => {
    const { p, span } = liveGraphicFixture(mode);
    p.layers[0].keys[1].shapes[0].symbolPlayback!.firstFrame = 9998;
    p.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = mode === 'loop' ? 2 : 9998;
    const source = createLiveGraphics(p, span);
    await equivalent(source, projectWith(source, operation(source, 8)));
  });
it('preserves absent and own undefined authored endpoint playback metadata', async () => {
  const { p, span } = liveGraphicFixture('default');
  span.end = 7;
  p.layers[0].keys[2].frame = 7;
  for (const key of [p.layers[0].keys[1], p.layers[0].keys[2]])
    key.shapes[0].symbolPlayback = undefined;
  const source = createLiveGraphics(p, span),
    layer = operation(source, 4);
  for (const frame of [2, 7])
    expect(
      Object.hasOwn(layer.keys.find((k) => k.frame === frame)!.shapes[0], 'symbolPlayback'),
    ).toBe(true);
  await equivalent(source, projectWith(source, layer));
});
it('preserves plain companions, pivots, options, settings and independently timed opacity', async () => {
  const { p, span } = liveGraphicFixture();
  span.ease = 'in';
  span.opacityEase = 'out';
  span.options = { affine: false, paint: false };
  for (const key of p.layers[0].keys)
    if (key.shapes.length) {
      key.shapes[0].opacity = key.frame === 2 ? 0 : 1;
      key.shapes[0].pivot = { x: 2, y: -4 };
      key.shapes.push({
        id: 'plain',
        kind: 'rectangle',
        x: key.shapes[0].x,
        y: 100,
        width: 8,
        height: 8,
        rotation: 0,
        fill: '#0000ff',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      });
    }
  const source = createLiveGraphics(p, span),
    layer = operation(source, 4);
  expect(layer.liveMotionSpans!.map((s) => s.options)).toEqual([span.options, span.options]);
  await equivalent(source, projectWith(source, layer));
});
for (const path of ['cubic', 'straightDistance', 'curvedDistance'])
  it(`keeps existing ${path} restriction arithmetic`, async () => {
    const p = fixture(),
      s = p.layers[0].liveMotionSpans![0];
    s.path =
      path === 'cubic'
        ? { startX: 0, startY: 20, endX: 0, endY: 20 }
        : path === 'straightDistance'
          ? { startX: 80 / 3, startY: 40 / 3, endX: -80 / 3, endY: -40 / 3, distance: true }
          : { startX: 0, startY: 80, endX: 0, endY: -40, distance: true };
    const before = structuredClone(p);
    if (path === 'curvedDistance') expect(() => operation(p)).toThrow(/reproduce|unresolved/);
    else await equivalent(p, projectWith(p, operation(p)));
    expect(p).toEqual(before);
  });
for (const failure of [
  'clock',
  'button',
  'movie',
  'plain',
  'foreignLayer',
  'foreignSpan',
  'occupied',
  'early',
  'fraction',
  'sameID',
])
  it(`rejects original ${failure} admission without writes`, () => {
    const p = fixture(),
      layer = p.layers[0],
      span = layer.liveMotionSpans![0];
    if (failure === 'clock') layer.keys[2].shapes[0].symbolPlayback!.firstFrame = 2;
    if (failure === 'button') p.symbols![0].buttonStates = { up: 0, over: 1, down: 2, hit: 3 };
    if (failure === 'movie') layer.keys[1].shapes[0].symbolPlayback!.mode = 'movie';
    if (failure === 'plain') delete span.symbolContinuity;
    if (failure === 'occupied') layer.keys.splice(2, 0, { frame: 6, shapes: [] });
    const before = structuredClone(p);
    expect(() =>
      split(
        p,
        failure === 'foreignLayer' ? structuredClone(layer) : layer,
        failure === 'foreignSpan' ? structuredClone(span) : span,
        failure === 'early' ? 3 : failure === 'fraction' ? 5.5 : 6,
        failure === 'sameID' ? 'live' : 'right',
      ),
    ).toThrow();
    expect(p).toEqual(before);
  });
it('keeps root/group split default scopes separate', () => {
  const p = fixture(),
    layer = p.layers[0],
    span = layer.liveMotionSpans![0];
  expect(() => rootSplit(p, layer, span, 6, 'right')).toThrow(/graphic/);
  expect(() => groupSplit(p, layer, span, 6, 'right')).toThrow(/group/);
});
for (const field of ['get', 'prototype', 'NaN', 'Infinity'])
  it(`rejects raw library ${field} before transport`, () => {
    const p = fixture();
    let reads = 0;
    if (field === 'get')
      Object.defineProperty(p.symbols![0].timeline, 'duration', {
        enumerable: true,
        get() {
          reads++;
          return 5;
        },
      });
    if (field === 'prototype')
      Object.setPrototypeOf(p.symbols![0], {
        get unknown() {
          reads++;
          return 1;
        },
      });
    if (field === 'NaN') p.symbols![0].shapes[0].x = NaN;
    if (field === 'Infinity') p.symbols![0].shapes[0].x = Infinity;
    expect(() => operation(p)).toThrow();
    expect(reads).toBe(0);
  });
for (const hook of ['source', 'output', 'candidate'])
  it(`rejects actual late ${hook} changes and preserves separate source edits`, () => {
    const p = fixture(),
      before = structuredClone(p),
      clone = structuredClone;
    let hit = false;
    vi.stubGlobal('structuredClone', (v: unknown) => {
      const out = clone(v),
        q = v as Layer;
      if (!hit && q?.liveMotionSpans?.length === 2 && q.liveMotionSpans[1].id === 'right') {
        hit = true;
        if (hook === 'source') p.symbols![0].name = 'Separate source edit';
        if (hook === 'output') (out as Layer).keys[2].shapes[0].x++;
        if (hook === 'candidate') q.keys[2].shapes[0].x++;
      }
      return out;
    });
    try {
      expect(() => operation(p)).toThrow();
      expect(hit).toBe(true);
      if (hook === 'source') before.symbols![0].name = 'Separate source edit';
      expect(p).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
it('admits the original aggregate library capacity and rejects overflow without per-frame duplication', () => {
  const { p, span, definition } = liveGraphicFixture(),
    art = definition.shapes[0];
  definition.shapes = Array.from({ length: MAX_SYMBOL_ARTWORK - 4 }, (_, i) => ({
    ...art,
    id: 'art' + i,
    points: [],
  }));
  const source = createLiveGraphics(p, span),
    layer = operation(source);
  expect(layer.keys.map((k) => k.frame)).toEqual([0, 2, 6, 10, 12]);
  source.symbols![0].shapes.push({ ...art, id: 'overflow' });
  expect(() => operation(source)).toThrow(/budget/);
}, 120000);

for (const scale of [1e-4, 1e4])
  it(`preserves relative graphic geometry scale ${scale}`, async () => {
    const p = fixture();
    for (const key of p.layers[0].keys)
      for (const shape of key.shapes) {
        shape.x *= scale;
        shape.y *= scale;
        shape.transform = [scale, 0, 0, scale];
      }
    const layer = operation(p, 4),
      out = projectWith(p, layer);
    await equivalent(p, out);
    const shape = evaluate(
        await prepareLiveMotionFrameCapture(() => ({ project: out, revision: 0 }), 6),
        6,
      )[0],
      point = mapPoint(matrix(shape), { x: 1, y: 1 });
    for (const [actual, expected] of [
      [point.x, 60 * scale],
      [point.y, (50 + Math.SQRT2) * scale],
    ])
      expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
        32 * Number.EPSILON * Math.max(1, Math.abs(expected)),
      );
  });
for (const direction of ['clockwise', 'counterclockwise'] as const)
  it(`restricts directed graphic ${direction} turns`, async () => {
    const p = fixture();
    p.layers[0].liveMotionSpans![0].rotation = { direction, turns: 1 };
    await equivalent(p, projectWith(p, operation(p)));
  });
it('preserves independent clocks on multiple original graphic instances', async () => {
  const p = fixture();
  for (const key of p.layers[0].keys)
    if (key.shapes.length) {
      const other = structuredClone(key.shapes[0]);
      other.id = 'other';
      other.y += 20;
      other.symbolPlayback!.firstFrame = key.frame === 2 ? 2 : 0;
      key.shapes.push(other);
    }
  const layer = operation(p, 8);
  expect(layer.keys.find((k) => k.frame === 8)!.shapes.map((s) => s.id)).toEqual([
    'instance',
    'other',
  ]);
  await equivalent(p, projectWith(p, layer));
});
it('retains actual curved compound symbol artwork without flattening the library', async () => {
  const { p, span, definition } = liveGraphicFixture('once');
  for (const artwork of [definition.shapes, ...definition.timeline!.keys.map((k) => k.shapes)])
    for (const shape of artwork) {
      shape.kind = 'polygon';
      shape.fillRule = 'evenodd';
      shape.contours = [
        [
          { x: 0, y: 0, out: { x: 2, y: -1 } },
          { x: 4, y: 0 },
          { x: 4, y: 4 },
          { x: 0, y: 4 },
        ],
        [
          { x: 1, y: 1 },
          { x: 1, y: 3 },
          { x: 3, y: 3 },
          { x: 3, y: 1 },
        ],
      ];
    }
  const source = createLiveGraphics(p, span),
    before = structuredClone(source),
    layer = operation(source, 8);
  await equivalent(source, projectWith(source, layer));
  expect(source).toEqual(before);
});
it('rejects genuine interpolation overflow without modifying source', () => {
  const p = fixture();
  p.layers[0].keys[1].shapes[0].x = 1e308;
  p.layers[0].keys[2].shapes[0].x = -1e308;
  const before = structuredClone(p);
  expect(() => operation(p)).toThrow();
  expect(p).toEqual(before);
});
it('rejects a late complete-candidate validation mutation and allows a fresh retry', () => {
  const p = fixture(),
    before = structuredClone(p),
    stringify = JSON.stringify;
  let hit = false;
  vi.spyOn(JSON, 'stringify').mockImplementation(((...args: Parameters<typeof stringify>) => {
    const out = stringify(...args),
      q = args[0] as Project;
    if (!hit && q?.layers?.[0]?.liveMotionSpans?.length === 2) {
      hit = true;
      q.layers[0].keys[2].shapes[0].symbolPlayback!.firstFrame = 3;
    }
    return out;
  }) as typeof stringify);
  try {
    expect(() => operation(p)).toThrow();
    expect(hit).toBe(true);
    expect(p).toEqual(before);
  } finally {
    vi.restoreAllMocks();
  }
  expect(operation(p).keys.map((k) => k.frame)).toEqual([0, 2, 6, 10, 12]);
});

it('retains the original representable in-out midpoint restriction', async () => {
  const p = fixture();
  p.layers[0].liveMotionSpans![0].ease = 'in-out';
  await equivalent(p, projectWith(p, operation(p, 6)));
});

for (const scale of [1e-6, 1e6])
  it(`retains existing document affine rejection for scale ${scale}`, () => {
    const p = fixture();
    for (const key of p.layers[0].keys)
      for (const shape of key.shapes) shape.transform = [scale, 0, 0, scale];
    const before = structuredClone(p);
    expect(() => operation(p)).toThrow(/affine transform/);
    expect(p).toEqual(before);
  });

for(const mode of ['loop','once','single']) it(`preserves keyed graphic placement and local playback across a split, ${mode}`,async()=>{
  const p=fixture(mode,'reflected'), span=p.layers[0].liveMotionSpans![0];
  span.xKeys=[{offset:4,value:84}]; span.xKeyEases=['in','out'];
  span.yKeys=[{offset:4,value:78}]; span.yKeyEases=['out','linear'];
  const source=structuredClone(p), layer=operation(p,4);
  const middle=layer.keys.find(k=>k.frame===4)!.shapes[0];
  expect([middle.x,middle.y]).toEqual([36,66]);
  expect(middle.symbolPlayback?.firstFrame).toBe(mode==='single'?1:3);
  const saved=JSON.parse(JSON.stringify(projectWith(p,layer)));
  await equivalent(p,saved);
  await equivalent(p,projectWith(p,operation(p,6)));
  expect(p).toEqual(source);
  span.path={startX:1,startY:0,endX:-1,endY:0};
  expect(()=>validateProject(p)).toThrow();
  delete span.path;
  span.scaleXKeys=[];
  expect(()=>validateProject(p)).toThrow();
});

it('rejects keyed placement on multiple graphics or an inconsistent child clock before a split',()=>{
  const p=fixture(), layer=p.layers[0], span=layer.liveMotionSpans![0];
  span.xKeys=[{offset:3,value:40}];
  const pair=layer.keys.filter(key=>key.frame===span.start || key.frame===span.end);
  for(const key of pair) key.shapes.push({...structuredClone(key.shapes[0]),id:'second'});
  const multiple=structuredClone(p);
  expect(()=>operation(p)).toThrow();
  expect(p).toEqual(multiple);
  for(const key of pair) key.shapes.pop();
  pair[1].shapes[0].symbolPlayback!.firstFrame=2;
  const invalid=structuredClone(p);
  expect(()=>operation(p)).toThrow();
  expect(p).toEqual(invalid);
});

for(const mode of ['loop','once','single']) it(`preserves graphic keyed angles and opacity through subdivision, ${mode}`,async()=>{
  const p=fixture(mode,'reflected'), span=p.layers[0].liveMotionSpans![0];
  span.rotation={direction:'clockwise',turns:2};
  span.rotationKeys=[{offset:4,value:480}]; span.rotationKeyEases=['out','in'];
  span.opacityKeys=[{offset:4,value:0.25}]; span.opacityKeyEases=['in','out'];
  const source=structuredClone(p);
  for(const at of [4,6,8]){
    const layer=operation(p,at), middle=layer.keys.find(k=>k.frame===at)!.shapes[0];
    expect(middle.rotation).toBe(at===4?360:at===6?480:382.5);
    expect(middle.opacity).toBe(at===4?0.8125:at===6?0.25:0.8125);
    for(const half of layer.liveMotionSpans!) expect(half.rotation).toEqual(span.rotation);
    await equivalent(p,JSON.parse(JSON.stringify(projectWith(p,layer))));
  }
  expect(p).toEqual(source);
  span.path={startX:5,startY:0,endX:-5,endY:0,tangent:true};
  expect(()=>validateProject(p)).toThrow(/tangent/);
});

it('preserves keyed scale and shear and rejects unsafe graphic transforms atomically', async () => {
  const p = fixture(), span = p.layers[0].liveMotionSpans![0];
  for (const key of p.layers[0].keys)
    for (const shape of key.shapes) shape.transform = [2, 0, 0.5, -3];
  span.scaleXKeys = [{ offset: 4, value: 4 }];
  span.scaleYKeys = [{ offset: 4, value: -1 }];
  span.shearKeys = [{ offset: 4, value: 1.5 }];
  span.sxKeyEases = ['in', 'linear'];
  span.syKeyEases = ['out', 'linear'];
  expect(() => operation(p)).toThrow(/affine|scale and skew/i);
  span.options = { affine: true };
  for (const at of [4, 6, 8]) {
    const layer = operation(p, at);
    if (at === 4) {
      const placement = layer.keys.find(k => k.frame === at)!.shapes[0];
      expect(placement.transform).toEqual([2.5, 0, 1, -1.5]);
      expect(placement.symbolPlayback!.firstFrame).toBe(3);
    }
    await equivalent(p, projectWith(p, layer));
  }
  for (const unsafe of [1, -1e-12]) {
    span.scaleYKeys = [{ offset: 4, value: unsafe }];
    const source = structuredClone(p);
    expect(() => operation(p)).toThrow(/reflection|nonsingular/);
    expect(p).toEqual(source);
  }
});

it('uses the decomposed endpoint angle when the graphic explicitly interpolates its affine basis',async()=>{
  const p=fixture('loop','reflected'), span=p.layers[0].liveMotionSpans![0];
  span.options={affine:true};
  span.rotationKeys=[{offset:4,value:-405}];
  span.opacityKeys=[{offset:4,value:0}];
  const mid=operation(p,4), promoted=mid.keys.find(k=>k.frame===4)!.shapes[0];
  const startAngle=Math.atan2(0.25,-2)*180/Math.PI;
  expect(promoted.rotation).toBeCloseTo((startAngle-405)/2,10);
  expect(promoted.opacity).toBe(0.5);
  await equivalent(p,projectWith(p,mid));
  span.opacityKeys=[{offset:4,value:1.01}];
  expect(()=>operation(p)).toThrow();
});
