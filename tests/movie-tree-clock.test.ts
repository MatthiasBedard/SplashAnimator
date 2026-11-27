import { expect, it } from 'vitest';
import {
  newProject,
  clone,
  validateProject,
  symbolLayers,
  type SymbolDefinition,
  type Vector,
} from '../packages/document/src';
import {
  createMovieTreeClock,
  createMovieTreeRuntime,
} from '../packages/animation/src/movie-tree-clock';
import { createMovieClock } from '../packages/animation/src/movie-clock';
import { compileMovieClockPlan } from '../packages/animation/src/movie-clock-plan';
import { evaluate } from '../packages/animation/src';
import { expandSymbols } from '../packages/geometry/src/symbols';

const movie = (id: string, symbolId: string, firstFrame = 0): Vector => ({
  id,
  symbolId,
  kind: 'symbol',
  symbolPlayback: { mode: 'movie', firstFrame },
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  fill: '#000000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
function fixture() {
  const p = newProject();
  p.fps = 10;
  p.duration = 6;
  p.layers[0].id = 'root';
  const child = movie('child', 'leaf');
  const leaf: SymbolDefinition = { id: 'leaf', name: 'Leaf', width: 10, height: 10, shapes: [] };
  const parent: SymbolDefinition = {
    id: 'parent',
    name: 'Parent',
    width: 10,
    height: 10,
    shapes: [child],
    timeline: { duration: 4, keys: [] },
  };
  p.symbols = [parent, leaf];
  p.layers[0].keys[0].shapes = [movie('a', 'parent')];
  return { p, parent, child, leaf };
}

it('keeps nested movie time independent across containing holds, loops and a paused root', () => {
  const { p, parent } = fixture();
  parent.timeline!.keys = [{ frame: 2, shapes: clone(parent.shapes) }];
  const clock = createMovieTreeClock();
  expect(clock.sample(p, 0, 0, 0)).toMatchObject({ 'root/a/parent': 0, 'root/a/child/leaf': 0 });
  expect(clock.sample(p, 5, 0.5, 5)['root/a/child/leaf']).toBe(5);
  expect(clock.sample(p, 0, 0.6, 6)['root/a/child/leaf']).toBe(6);
  expect(clock.sample(p, 0, 1.3, 6)['root/a/child/leaf']).toBe(13);
  clock.reset();
  expect(clock.sample(p, 0, 50, 0)['root/a/child/leaf']).toBe(0);
});

it('finds descendant reentry through skipped parent loops without stepping every frame', () => {
  const { p, parent } = fixture();
  parent.timeline = {
    duration: 6,
    keys: [
      { frame: 2, shapes: [] },
      { frame: 4, shapes: clone(parent.shapes) },
    ],
  };
  const clock = createMovieTreeClock();
  clock.sample(p, 0, 0, 0);
  expect(clock.sample(p, 5, 0.5, 5)['root/a/child/leaf']).toBe(1);
  expect(clock.sample(p, 5, 600000.5, 6000005)['root/a/child/leaf']).toBe(1);
  expect(clock.sample(p, 0, 600000.6, 6000006)['root/a/child/leaf']).toBe(2);
});

it('isolates repeated definitions, nested layers and parent replacement lifetimes', () => {
  const { p, parent, child } = fixture();
  p.layers[0].keys = [
    { frame: 0, shapes: [movie('a', 'parent')] },
    { frame: 2, shapes: [movie('a', 'parent'), movie('b', 'parent')] },
    { frame: 3, shapes: [movie('b', 'parent')] },
    { frame: 4, shapes: [movie('a', 'parent'), movie('b', 'parent')] },
  ];
  parent.timeline!.layers = [
    {
      id: 'extra',
      name: 'Extra',
      visible: true,
      locked: false,
      keys: [{ frame: 0, shapes: [clone(child)] }],
    },
  ];
  const clock = createMovieTreeClock();
  clock.sample(p, 0, 0, 0);
  const result = clock.sample(p, 5, 0.5, 5);
  expect(result['root/a/child/leaf']).toBe(1);
  expect(result['root/b/child/leaf']).toBe(3);
  expect(result['root/a/extra/child/leaf']).toBe(1);
  expect(result['root/b/extra/child/leaf']).toBe(3);
  p.layers[0].visible = false;
  expect(clock.sample(p, 5, 0.6, 5)).toEqual({});
  p.layers[0].visible = true;
  expect(clock.sample(p, 5, 0.7, 5)['root/b/child/leaf']).toBe(0);
  expect(clock.sample(p, 0, 0.8, 0)['root/a/child/leaf']).toBe(0);
});

it('retains fractional start phase and primes offset first frames before skipped samples', () => {
  const { p, parent } = fixture();
  parent.timeline = {
    duration: 6,
    keys: [
      { frame: 2, shapes: [] },
      { frame: 4, shapes: clone(parent.shapes) },
    ],
  };
  p.layers[0].keys[0].shapes[0].symbolPlayback!.firstFrame = 4;
  const clock = createMovieTreeClock();
  expect(clock.sample(p, 0, 0.055, 0)['root/a/child/leaf']).toBe(0);
  expect(clock.sample(p, 0, 0.12, 0)['root/a/child/leaf']).toBe(0);
  expect(clock.sample(p, 0, 0.16, 0)['root/a/child/leaf']).toBe(1);
  expect(clock.sample(p, 0, 0.64, 0)['root/a/child/leaf']).toBeUndefined();
  expect(clock.sample(p, 0, 0.76, 0)['root/a/child/leaf']).toBe(1);
  expect(clock.sample(p, 0, 0.8, 0)['root/a/child/leaf']).toBe(1);
  expect(clock.sample(p, 0, 0.86, 0)['root/a/child/leaf']).toBe(2);
});

it('handles three movie generations and guards cycles without changing document data', () => {
  const { p, leaf } = fixture();
  const last: SymbolDefinition = { id: 'last', name: 'Last', width: 10, height: 10, shapes: [] };
  leaf.shapes = [movie('grandchild', 'last')];
  p.symbols!.push(last);
  const before = clone(p),
    clock = createMovieTreeClock();
  clock.sample(p, 0, 0, 0);
  expect(clock.sample(p, 5, 0.5, 5)['root/a/child/grandchild/last']).toBe(5);
  expect(p).toEqual(before);
  last.shapes = [movie('cycle', 'parent')];
  clock.reset(); // Playback topology is a snapshot; editing/history starts a new session.
  expect(() => clock.sample(p, 5, 0.6, 5)).toThrow('cycle');
});

it('keeps movies inside looping graphics independent while detecting skipped graphic reentries', () => {
  const { p, parent } = fixture();
  p.duration = 12;
  p.layers[0].keys[0].shapes[0].symbolPlayback!.mode = 'loop';
  parent.timeline = {
    duration: 6,
    keys: [
      { frame: 2, shapes: [] },
      { frame: 4, shapes: clone(parent.shapes) },
    ],
  };
  const clock = createMovieTreeClock();
  expect(clock.sample(p, 0, 0, 0)).toEqual({ 'root/a/child/leaf': 0 });
  expect(clock.sample(p, 5, 0.5, 5)['root/a/child/leaf']).toBe(1);
  expect(clock.sample(p, 11, 1.1, 11)['root/a/child/leaf']).toBe(1);
  expect(clock.sample(p, 11, 2, 11)['root/a/child/leaf']).toBe(10);
  expect(clock.sample(p, 5, 600002.6, 6000017)['root/a/child/leaf']).toBe(1);
});

it('continues nested movie time after a graphic stops once or holds a single frame', () => {
  for (const mode of ['once', 'single'] as const) {
    const { p, parent } = fixture();
    p.duration = 20;
    p.layers[0].keys[0].shapes[0].symbolPlayback = { mode, firstFrame: 2 };
    parent.timeline = {
      duration: 4,
      keys: [
        { frame: 1, shapes: [] },
        { frame: 2, shapes: clone(parent.shapes) },
      ],
    };
    const clock = createMovieTreeClock();
    clock.sample(p, 0, 0, 0);
    expect(clock.sample(p, 19, 1.9, 19)['root/a/child/leaf']).toBe(19);
    expect(clock.sample(p, 19, 3, 19)['root/a/child/leaf']).toBe(30);
  }
});

it('restarts descendants on graphic definition swaps even when descendant IDs match', () => {
  const { p, parent } = fixture();
  const alternate = { ...clone(parent), id: 'alternate' };
  p.symbols!.push(alternate);
  const graphic = p.layers[0].keys[0].shapes[0];
  graphic.symbolPlayback!.mode = 'single';
  p.layers[0].keys.push({ frame: 3, shapes: [{ ...clone(graphic), symbolId: 'alternate' }] });
  const clock = createMovieTreeClock();
  clock.sample(p, 0, 0, 0);
  expect(clock.sample(p, 2, 0.2, 2)['root/a/child/leaf']).toBe(2);
  expect(clock.sample(p, 3, 0.3, 3)['root/a/child/leaf']).toBe(0);
  expect(clock.sample(p, 5, 0.5, 5)['root/a/child/leaf']).toBe(2);
});

it('passes through graphic layers inside movies with the geometry evaluator identity', () => {
  const { p, parent, leaf } = fixture();
  const graphic: SymbolDefinition = {
    id: 'graphic',
    name: 'Graphic',
    width: 10,
    height: 10,
    shapes: [],
    timeline: {
      duration: 4,
      keys: [],
      layers: [
        {
          id: 'ink',
          name: 'Ink',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [movie('nested', 'leaf')] },
            { frame: 1, shapes: [] },
            { frame: 2, shapes: [movie('nested', 'leaf')] },
          ],
        },
      ],
    },
  };
  p.symbols!.push(graphic);
  parent.shapes = [{ ...movie('g', graphic.id), symbolPlayback: { mode: 'loop', firstFrame: 0 } }];
  parent.timeline!.duration = 8;
  const paint = { ...movie('paint', 'unused'), kind: 'rectangle' as const, fill: '#ff0000' };
  delete paint.symbolId;
  delete paint.symbolPlayback;
  leaf.shapes = [paint];
  leaf.timeline = { duration: 3, keys: [{ frame: 1, shapes: [{ ...paint, fill: '#0000ff' }] }] };
  const clock = createMovieTreeClock();
  clock.sample(p, 0, 0, 0);
  const frames = clock.sample(p, 3, 0.3, 3);
  expect(frames['root/a/g/ink/nested/leaf']).toBe(1);
  expect(evaluate(p, 3, frames)[0].fill).toBe('#0000ff');
  expect(evaluate(p, 3, frames)[0].id).toBe('a/g/ink/nested/paint');
});

it('serializes only movie topology and runs without module dependencies', () => {
  const { p } = fixture();
  p.layers[0].keys[0].shapes[0].symbolPlayback!.mode = 'single';
  p.duration = 10000;
  const plan = compileMovieClockPlan(p);
  expect(plan.layers[0].keys).toHaveLength(1);
  expect(JSON.stringify(plan)).not.toContain('strokeWidth');
  const standalone = new Function(
    'plan',
    `return (${createMovieTreeRuntime.toString()})(plan, ${createMovieClock.toString()});`,
  )(JSON.parse(JSON.stringify(plan)));
  standalone.sample(0, 0, 0);
  expect(standalone.sample(9999, 999.9, 9999)['root/a/child/leaf']).toBe(9999);
  const snapshot = clone(plan);
  p.symbols![0].shapes = [];
  expect(plan).toEqual(snapshot);
});

it('evaluates independently timed nested artwork with affine placement and a static editing pose', () => {
  const { p, parent, child, leaf } = fixture();
  const paint: Vector = { ...movie('paint', 'unused'), kind: 'rectangle', fill: '#ff0000' };
  delete paint.symbolId;
  delete paint.symbolPlayback;
  leaf.shapes = [paint];
  leaf.timeline = { duration: 3, keys: [{ frame: 2, shapes: [{ ...paint, fill: '#0000ff' }] }] };
  child.x = 3;
  child.opacity = 0.5;
  const a = p.layers[0].keys[0].shapes[0];
  a.x = 100;
  a.transform = [2, 0.25, 0.5, 1];
  a.opacity = 0.4;
  p.layers[0].keys.push({ frame: 2, shapes: [clone(a), { ...movie('b', 'parent'), x: 200 }] });
  const clock = createMovieTreeClock();
  clock.sample(p, 0, 0, 0);
  const frames = clock.sample(p, 2, 0.2, 2);
  const shapes = evaluate(p, 2, frames);
  expect(shapes.map((s) => s.fill)).toEqual(['#0000ff', '#ff0000']);
  expect(shapes.map((s) => s.id)).toEqual(['a/child/paint', 'b/child/paint']);
  expect(shapes[0].x).toBe(106);
  expect(shapes[0].y).toBe(0.75);
  expect(shapes[0].opacity).toBeCloseTo(0.2);
  expect(shapes[0].transform).toEqual([2, 0.25, 0.5, 1]);
  expect(expandSymbols(p, [a])[0].fill).toBe('#ff0000');
  expect(validateProject(p)).toEqual(p);
  expect(parent.shapes[0].x).toBe(3);
});

it('qualifies 768 repeated child lifetimes and offset poses after a six-million-frame jump', () => {
  const { p, parent, leaf } = fixture();
  const art: Vector = {
    id: 'paint',
    kind: 'rectangle',
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    rotation: 0,
    fill: '#ff0000',
    stroke: '#000000',
    strokeWidth: 0,
    points: [],
  };
  leaf.shapes = [art];
  leaf.timeline = {
    duration: 3,
    keys: [
      { frame: 1, shapes: [{ ...art, fill: '#00ff00' }] },
      { frame: 2, shapes: [{ ...art, fill: '#0000ff' }] },
    ],
  };
  parent.shapes = Array.from({ length: 12 }, (_, i) => movie('child' + i, 'leaf', i % 3));
  parent.timeline = {
    duration: 6,
    keys: [
      { frame: 2, shapes: [] },
      { frame: 4, shapes: clone(parent.shapes) },
    ],
  };
  p.layers[0].keys[0].shapes = Array.from({ length: 64 }, (_, i) => ({
    ...movie('parent' + i, 'parent'),
    x: i * 10,
  }));
  validateProject(p);
  const before = clone(p),
    clock = createMovieTreeClock(),
    runtime = createMovieTreeRuntime(compileMovieClockPlan(p), createMovieClock);
  clock.sample(p, 0, 0, 0);
  runtime.sample(0, 0, 0);
  const frames = clock.sample(p, 5, 600000.5, 6000005);
  expect(runtime.sample(5, 600000.5, 6000005)).toEqual(frames);
  expect(Object.keys(frames)).toHaveLength(64 * 13);
  for (let i = 0; i < 64; i++)
    for (let j = 0; j < 12; j++) expect(frames['root/parent' + i + '/child' + j + '/leaf']).toBe(1);
  const shapes = evaluate(p, 5, frames);
  expect(shapes).toHaveLength(768);
  for (let i = 0; i < shapes.length; i++)
    expect(shapes[i].fill).toBe(['#00ff00', '#0000ff', '#ff0000'][i % 3]);
  expect(p).toEqual(before);
  clock.reset();
  expect(clock.sample(p, 0, 0, 0)['root/parent63/child11/leaf']).toBe(0);
});

it('exposes detached movie lifetime origins for routing even when skipped reentry returns the same elapsed frame', () => {
  const { p, parent } = fixture();
  parent.timeline = {
    duration: 6,
    keys: [
      { frame: 2, shapes: [] },
      { frame: 4, shapes: clone(parent.shapes) },
    ],
  };
  const standalone = new Function(
    `return (${createMovieTreeRuntime.toString()})`,
  )() as typeof createMovieTreeRuntime;
  for (const clock of [
    createMovieTreeClock(),
    createMovieTreeRuntime(compileMovieClockPlan(p), createMovieClock),
    standalone(compileMovieClockPlan(p), createMovieClock),
  ]) {
    const sample = (frame: number, seconds: number, position: number) =>
      clock.sample.length === 4
        ? (clock as ReturnType<typeof createMovieTreeClock>).sample(p, frame, seconds, position)
        : (clock as ReturnType<typeof createMovieTreeRuntime>).sample(frame, seconds, position);
    expect(clock.origins()).toEqual({});
    sample(0, 0, 0);
    const first = sample(5, 0.5, 5);
    const origins = clock.origins();
    expect(Object.keys(origins).sort()).toEqual(Object.keys(first).sort());
    expect(origins['root/a/parent']).toBe(0);
    expect(origins['root/a/child/leaf']).toBeCloseTo(0.4);
    const returned = sample(5, 600000.5, 6000005);
    expect(returned['root/a/child/leaf']).toBe(first['root/a/child/leaf']);
    expect(clock.origins()['root/a/child/leaf']).toBeCloseTo(600000.4);
    expect(clock.origins()['root/a/parent']).toBe(0);
    origins['root/a/parent'] = 999;
    expect(clock.origins()['root/a/parent']).toBe(0);
    sample(2, 600000.8, 6000008);
    expect(clock.origins()).toEqual({ 'root/a/parent': 0 });
    sample(0, 600000.9, 0); // Root rewind starts fresh scopes even without a time rewind.
    expect(clock.origins()['root/a/parent']).toBe(600000.9);
    clock.reset();
    expect(clock.origins()).toEqual({});
  }
});

it.each(['single', 'once'] as const)('compiles long %s graphic holds without spending budget on unchanged frames', (mode) => {
  const { p, parent } = fixture();
  p.duration = 10000;
  p.layers[0].keys[0].shapes = Array.from({ length: 200 }, (_, i) => ({ ...movie(`g${i}`, parent.id), symbolPlayback: { mode, firstFrame: 0 } }));
  const plan = compileMovieClockPlan(p);
  expect(plan.layers[0].keys).toHaveLength(1);
  expect(plan.layers[0].keys[0].shapes).toHaveLength(200);
  const clock = createMovieTreeRuntime(plan, createMovieClock);
  clock.sample(0, 0, 0);
  expect(clock.sample(9999, 999.9, 9999)['root/g199/child/leaf']).toBe(9999);
  expect(clock.sample(0, 1000, 10000)['root/g199/child/leaf']).toBe(10000);
});
it('retains once transitions, authored restarts and looping siblings when skipping stopped exposure tails', () => {
  const { p, parent } = fixture();
  p.duration = 100;
  parent.timeline = { duration: 4, keys: [{ frame: 1, shapes: [] }, { frame: 3, shapes: clone(parent.shapes) }] };
  const once = { ...movie('once', parent.id), symbolPlayback: { mode: 'once' as const, firstFrame: 0 } };
  p.layers[0].keys = [{ frame: 0, shapes: [once] }, { frame: 50, shapes: [clone(once)] }];
  const plan = compileMovieClockPlan(p);
  expect(plan.layers[0].keys.map(k => k.frame)).toEqual([0, 1, 3, 51, 53]);
  const clock = createMovieTreeRuntime(plan, createMovieClock);
  clock.sample(0, 0, 0);
  expect(clock.sample(49, 4.9, 49)['root/once/child/leaf']).toBe(46);
  expect(clock.sample(52, 5.2, 52)).toEqual({});
  expect(clock.sample(53, 5.3, 53)['root/once/child/leaf']).toBe(0);
  const loop = { ...movie('loop', parent.id), symbolPlayback: { mode: 'loop' as const, firstFrame: 0 } };
  p.layers[0].keys = [{ frame: 0, shapes: [once, loop] }];
  const mixed = createMovieTreeRuntime(compileMovieClockPlan(p), createMovieClock);
  mixed.sample(0, 0, 0);
  const result = mixed.sample(99, 9.9, 99);
  expect(result['root/once/child/leaf']).toBe(96);
  expect(result['root/loop/child/leaf']).toBe(0);
});

it('retains the compilation budget for advancing wrappers and handles clamped or one-frame wrappers', () => {
  const { p, parent } = fixture();
  p.duration = 10000;
  p.layers[0].keys[0].shapes = Array.from({ length: 200 }, (_, i) => ({ ...movie(`g${i}`, parent.id), symbolPlayback: { mode: 'loop' as const, firstFrame: 0 } }));
  parent.timeline!.keys = [{frame:1,shapes:[]},{frame:2,shapes:clone(parent.shapes)},{frame:3,shapes:[]}];
  expect(() => compileMovieClockPlan(p)).toThrow(/compilation budget/);
  parent.timeline!.keys = [];
  for (const shape of p.layers[0].keys[0].shapes) shape.symbolPlayback = { mode: 'once', firstFrame: 9999 };
  expect(compileMovieClockPlan(p).layers[0].keys).toHaveLength(1);
  parent.timeline!.duration = 1;
  for (const shape of p.layers[0].keys[0].shapes) shape.symbolPlayback = { mode: 'loop', firstFrame: 0 };
  expect(compileMovieClockPlan(p).layers[0].keys).toHaveLength(1);
});


it('compiles advancing graphic holds at nested exposure boundaries', () => {
  const { p, parent } = fixture();
  p.duration = 10000;
  parent.timeline = { duration: 1000, keys: [
    { frame: 500, shapes: [] }, { frame: 750, shapes: clone(parent.shapes) },
  ] };
  p.layers[0].keys[0].shapes = Array.from({length:200}, (_,i)=>({
    ...movie(`g${i}`,parent.id), symbolPlayback:{mode:'loop' as const,firstFrame:100},
  }));
  const before=clone(p), plan=compileMovieClockPlan(p);
  expect(plan.layers[0].keys.map(k=>k.frame)).toEqual([0,...Array.from({length:10},(_,i)=>[400+1000*i,650+1000*i]).flat()]);
  const clock=createMovieTreeRuntime(plan,createMovieClock);
  clock.sample(0,0,0);
  expect(clock.sample(499,49.9,499)).toEqual({});
  expect(clock.sample(9999,999.9,9999)['root/g199/child/leaf']).toBe(349);
  expect(p).toEqual(before);
});


it('matches frame-by-frame nested topology through offset wraps, clamps and authored keys', () => {
  const {p,parent,leaf}=fixture();
  p.duration=133;
  parent.timeline={duration:7,keys:[{frame:2,shapes:[]},{frame:5,shapes:clone(parent.shapes)}]};
  const graphic=(id:string, mode:'loop'|'once'|'single', firstFrame:number):Vector=>({
    ...movie(id,parent.id),symbolPlayback:{mode,firstFrame},
  });
  const outer:SymbolDefinition={id:'outer',name:'Outer',width:10,height:10,
    shapes:[graphic('loop','loop',3),graphic('once','once',1),graphic('single','single',5)],
    timeline:{duration:19,keys:[{frame:11,shapes:[graphic('loop','loop',0)]}]},
  };
  p.symbols=[parent,leaf,outer];
  const root=(mode:'loop'|'once'|'single'):Vector=>({
    ...movie(mode,outer.id),symbolPlayback:{mode,firstFrame:4},
  });
  p.layers[0].keys=[{frame:0,shapes:[root('loop'),root('once'),root('single')]},
    {frame:61,shapes:[{...root('loop'),symbolPlayback:{mode:'loop',firstFrame:17}}]}];
  const plan=compileMovieClockPlan(p);
  // Deliberately visit every frame: this oracle has no event prediction or skipping.
  function visit(shapes:Vector[], age:number, prefix='', ancestry:string[]=[]): unknown[] {
    return shapes.flatMap(shape=>{
      if(shape.kind!=='symbol') return [];
      const path=prefix+shape.id;
      if(shape.symbolPlayback?.mode==='movie') return [{
        id:prefix?JSON.stringify([...ancestry,shape.id,shape.symbolId]):shape.id,
        instancePath:path,kind:'symbol',symbolId:shape.symbolId,symbolPlayback:shape.symbolPlayback,
      }];
      const definition=p.symbols!.find(d=>d.id===shape.symbolId)!;
      const duration=definition.timeline?.duration??1, first=Math.min(shape.symbolPlayback?.firstFrame??0,duration-1);
      const frame=shape.symbolPlayback?.mode==='single'?first:shape.symbolPlayback?.mode==='once'?Math.min(first+age,duration-1):(first+age)%duration;
      return symbolLayers(definition).filter(l=>l.visible).flatMap(layer=>{
        const key=layer.keys.filter(k=>k.frame<=frame).at(-1)!;
        return visit(key.shapes,frame-key.frame,path+(layer.id==='@base'?'':'/'+layer.id)+'/',[...ancestry,shape.id,definition.id,layer.id]);
      });
    });
  }
  for(let frame=0;frame<p.duration;frame++) {
    const key=p.layers[0].keys.filter(k=>k.frame<=frame).at(-1)!;
    const actual=plan.layers[0].keys.filter(k=>k.frame<=frame).at(-1)!.shapes;
    expect(actual,`frame ${frame}`).toEqual(visit(key.shapes,frame-key.frame));
  }
});
