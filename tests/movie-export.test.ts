import { createExportButtonMovieRuntime } from '../packages/export-web/src/button-movie-runtime';
import { createMovieTreeRuntime } from '../packages/animation/src/movie-tree-clock';
import { createMovieClock } from '../packages/animation/src/movie-clock';
import { it, expect } from 'vitest';
import { newProject, clone } from '../packages/document/src';
import { convertToSymbol, symbolInstance } from '../packages/geometry/src/symbols';
import { exportHTML, exportPresentationHTML, exportScriptReplayHTML, type PresentationPose } from '../packages/export-web/src';
import { graphicTransformOwner } from '../packages/animation/src/placement-transform';
import { encodePcm16Wav } from '../packages/audio/src/wav-encode';

it('admits a complete replay WAV with the terminal frame duration and rejects mismatched timing',()=>{
  const p=newProject();p.fps=10;
  const poses=[{frame:0,tick:0},{frame:0,tick:1}];
  const wave=encodePcm16Wav([new Float32Array(1600)],8000);
  const html=exportScriptReplayHTML(p,poses,undefined,wave);
  expect(html).toContain('Play replay');
  expect(html).toContain(Buffer.from(wave).toString('base64'));
  expect(exportScriptReplayHTML(p,poses)).not.toContain('data:audio/wav');
  expect(exportHTML(p)).not.toContain('Play replay');
  expect(()=>exportScriptReplayHTML(p,poses,undefined,encodePcm16Wav([new Float32Array(800)],8000)))
    .toThrow('does not match the recorded timeline');
  const corrupt=wave.slice();corrupt[34]=8;
  expect(()=>exportScriptReplayHTML(p,poses,undefined,corrupt)).toThrow('does not match the recorded timeline');
  expect(wave[34]).toBe(16);
});

function replayTransformProject() {
  const p=newProject();
  p.duration=4;
  const art={id:'ink',kind:'rectangle' as const,x:0,y:0,width:8,height:4,rotation:0,fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  const definition={id:'art',name:'Art',width:8,height:4,shapes:[art]};
  const actor={...symbolInstance(definition,3,4),instanceName:'Actor',instanceBlur:2};
  p.symbols=[definition];
  const layer=p.layers[0];
  layer.keys=[{frame:0,shapes:[actor]},{frame:2,shapes:[{...actor,x:10}]}];
  const owner=graphicTransformOwner(p)(layer,0,actor)!;
  return {p,owner};
}

it('pools transformed effect variants for one original exposure and retains the authored recovery',()=>{
  const {p,owner}=replayTransformProject();
  const before=clone(p);
  const poses: PresentationPose[]=[
    {frame:0,tick:0},
    {frame:0,tick:1,placementTransforms:[[owner,24,8,90,[1,0,.5,1]]]},
    {frame:2,tick:2},
    {frame:1,tick:3},
    {frame:1,tick:4,placementTransforms:[]},
  ];
  const html=exportScriptReplayHTML(p,poses);
  const compiled=JSON.parse(html.slice(html.indexOf('const p=')+8,html.indexOf(',c=document.querySelector')));
  expect(compiled.transformVariants).toHaveLength(1);
  const [variant]=compiled.transformVariants[0];
  expect(variant.blurRadius).toBe(2);
  expect(variant.maskLayers[0].shapes[0]).toMatchObject({x:24,y:8});
  expect(variant.worldBounds).toBeDefined();
  expect(compiled.layers[0].keys[0].shapes[0].transformOwner).toBe(0);
  expect(compiled.layers[0].keys[1].shapes[0].transformOwner).toBeUndefined();
  expect(exportPresentationHTML(p,poses)).toBe(exportPresentationHTML(p,poses.map(({frame,tick})=>({frame,tick}))));
  expect(p).toEqual(before);
});

it('rejects invalid and unknown replay transform entries without reading getters',()=>{
  const {p,owner}=replayTransformProject();
  const initial={frame:0,tick:0};
  expect(()=>exportScriptReplayHTML(p,[initial,{frame:0,tick:1,placementTransforms:[['missing',1,2,0]]}]))
    .toThrow('Unknown replay Graphic transform target');
  expect(()=>exportScriptReplayHTML(p,[initial,{frame:0,tick:1,placementTransforms:[[owner,1,2,0,[1,0,0,0]]]}]))
    .toThrow('nonsingular');
  const entry:[string,number,number,number]=[owner,1,2,0];
  Object.defineProperty(entry,1,{get(){throw Error('Getter must not run');}});
  expect(()=>exportScriptReplayHTML(p,[initial,{frame:0,tick:1,placementTransforms:[entry]}]))
    .toThrow('Invalid script placement transform entry');
  const pose=Object.defineProperty({frame:0,tick:1},'placementTransforms',{
    get(){throw Error('Getter must not run');},
  });
  expect(()=>exportScriptReplayHTML(p,[initial,pose])).toThrow('Invalid replay placement transform field');
});

it('checks replay spawn ownership, original origins and limits before compiling paint',()=>{
  const {p}=replayTransformProject();
  p.symbols![0].timeline={duration:2,keys:[]};
  p.libraryLinks=[{id:'art',kind:'symbol',name:'lib.Art'}];
  const first={frame:0,tick:0};
  const create: PresentationPose={frame:1,tick:1,spawnedGraphics:[['child','art',10,12,0,'timeline',1,1]]};
  const remove: PresentationPose={frame:1,tick:2,spawnedGraphics:[]};
  const reuse={...create,tick:3};
  const later={...reuse,spawnedGraphics:[['child','art',10,12,0,'timeline',3,1]]} satisfies PresentationPose;
  expect(()=>exportScriptReplayHTML(p,[first,create,remove,reuse])).toThrow('Invalid spawned symbol origin.');
  expect(()=>exportScriptReplayHTML(p,[first,{...create,frame:0}])).toThrow('Invalid spawned symbol origin.');
  expect(()=>exportScriptReplayHTML(p,[first,{...create,spawnedGraphics:[['child','unknown',0,0,0]]}])).toThrow('unavailable');
  expect(()=>exportScriptReplayHTML(p,[first,{...create,spawnedGraphics:Array.from({length:129},(_,index)=>['child'+index,'art',0,0,0])}])).toThrow('up to 128');
  const unreadable=Object.defineProperty({frame:0,tick:1},'spawnedGraphics',{get(){throw Error('Getter must not run');}});
  expect(()=>exportScriptReplayHTML(p,[first,unreadable])).toThrow('Invalid replay spawned artwork field.');
  const before=clone(p);
  const html=exportScriptReplayHTML(p,[first,create,remove,later]);
  const compiled=JSON.parse(html.slice(html.indexOf('const p=')+8,html.indexOf(',c=document.querySelector')));
  expect(compiled.layers.at(-1)).toMatchObject({id:'@script-graphics',keys:[{frame:0,shapes:[]}]});
  expect(compiled.spawnVariants).toHaveLength(1);
  expect(compiled.spawnVariants[0][0]).toMatchObject({x:10,y:12,fill:'#ff0000'});
  expect(exportPresentationHTML(p,[first,create])).toBe(exportPresentationHTML(p,[first,{frame:1,tick:1}]));
  expect(p).toEqual(before);
});

it('shares one movie definition across held frames and changing placements', () => {
  const p = newProject();
  p.duration = 200;
  const layer = p.layers[0];
  layer.keys[0].shapes = [
    {
      id: 'art',
      kind: 'rectangle',
      x: 0,
      y: 0,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    },
  ];
  const instance = convertToSymbol(p, layer.id, 0, ['art'], 'Movie');
  instance.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  p.symbols![0].timeline = { duration: 100, keys: [] };
  layer.keys = Array.from({ length: 200 }, (_, frame) => ({ frame, shapes: [clone(instance)] }));
  layer.keys[199].shapes[0].x = 100;
  const html = exportHTML(p);
  const data = JSON.parse(
    html.slice(html.indexOf('const p=') + 8, html.indexOf(',c=document.querySelector')),
  );
  expect(data.movieFrames).toHaveLength(0);
  expect(data.sharedArtwork).toHaveLength(1);
  expect(data.sharedArtwork[0].frames).toEqual(Array(100).fill(0));
  expect(data.sharedArtwork[0].poses).toHaveLength(1);
  expect(
    data.layers[0].keys
      .slice(0, 199)
      .every((key: { shapes: { sharedSymbol: number }[] }) => key.shapes[0].sharedSymbol === 0),
  ).toBe(true);
  expect(data.layers[0].keys[199].shapes[0]).toMatchObject({
    sharedSymbol: 0,
    placement: [1, 0, 0, 1, 100, instance.y],
  });
  expect(html.length).toBeLessThan(300000);
  expect(p.layers[0].keys[0].shapes[0]).toEqual(instance);
});

it.each([false, true])(
  'pools button poses and includes non-Up paint (static parent: %s)',
  (nested) => {
    const p = newProject();
    p.duration = 100;
    p.layers[0].keys[0].shapes = [
      {
        id: 'art',
        kind: 'rectangle',
        x: 0,
        y: 0,
        width: 20,
        height: 20,
        rotation: 0,
        fill: '#ff0000',
        stroke: '#000000',
        strokeWidth: 0,
        points: [],
      },
    ];
    convertToSymbol(p, p.layers[0].id, 0, ['art'], 'Button');
    const d = p.symbols![0];
    d.buttonStates = { up: 0, over: 1, down: 0, hit: 0 };
    d.timeline = {
      duration: 2,
      keys: [
        {
          frame: 1,
          shapes: [
            {
              ...d.shapes[0],
              bitmap: { assetId: 'image', x: 0, y: 0, width: 20, height: 20, repeat: false },
            },
          ],
        },
      ],
    };
    p.assets = [
      {
        id: 'image',
        path: 'assets/bitmaps/image.json',
        bitmap: { name: 'Image', width: 1, height: 1 },
      },
    ];
    expect(() => exportHTML(p)).toThrow('referenced bitmap');
    p.assets[0].bitmap!.dataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
    if (nested) {
      const wrapper = {
        id: 'wrapper',
        name: 'Static wrapper',
        width: 20,
        height: 20,
        shapes: [p.layers[0].keys[0].shapes[0]],
      };
      p.symbols!.push(wrapper);
      p.layers[0].keys[0].shapes = [symbolInstance(wrapper, 100, 0)];
    }
    const html = exportHTML(p);
    const data = JSON.parse(
      html.slice(html.indexOf('const p=') + 8, html.indexOf(',c=document.querySelector')),
    );
    expect(data.buttons).toHaveLength(1);
    expect(data.buttons[0].poses.over[0].bitmap.assetId).toBe('image');
    expect(data.assets).toHaveLength(1);
    expect(
      data.layers[0].keys.every((k: { shapes: { button: number }[] }) => k.shapes[0].button === 0),
    ).toBe(true);
  },
);

it.each([2, 128])('exported state plans pool %i instances and keep clocks independent', (count) => {
  const p = newProject();
  p.fps = 2;
  const art = {
    id: 'red',
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
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 20,
    height: 20,
    shapes: [art],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#0000ff' }] }] },
  };
  const movie = symbolInstance(leaf, 0, 0);
  movie.symbolPlayback = { mode: 'movie', firstFrame: 0 };
  const graphic = { id: 'graphic', name: 'Graphic', width: 20, height: 20, shapes: [movie] };
  const g = symbolInstance(graphic, 0, 0);
  const button = {
    id: 'b',
    name: 'Button',
    width: 20,
    height: 20,
    shapes: [g],
    buttonStates: { up: 0, over: 0, down: 1, hit: 1 },
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [g] }] },
  };
  p.symbols = [leaf, graphic, button];
  p.layers[0].keys[0].shapes = Array.from({ length: count }, (_, i) =>
    symbolInstance(button, i * 25, 0),
  );
  const html = exportHTML(p);
  const data = JSON.parse(
    html.slice(html.indexOf('const p=') + 8, html.indexOf(',c=document.querySelector')),
  );
  expect(data.buttonPlans).toHaveLength(1);
  expect(data.buttons.map((b: { plans: number }) => b.plans)).toEqual(Array(count).fill(0));
  expect(Object.keys(data.buttonPlans[0])).toEqual(['0', '1']);
  expect(data.buttons[0].poses.up[0].movie).toBeDefined();
  expect(data.buttons[0].poses.hit[0].commands).toBeDefined();
  let compiled = 0;
  const runtime = createExportButtonMovieRuntime(
    data.buttons,
    (plan, factory) => {
      compiled++;
      return createMovieTreeRuntime(plan, factory);
    },
    createMovieClock,
    data.buttonPlans,
  );
  const values = (index: number, state: 'up' | 'over' | 'down', time: number) =>
    Object.values(runtime.sample(index, state, time));
  runtime.update([0, 1]);
  expect(values(0, 'up', 0)).toEqual([0]);
  expect(values(1, 'up', 0)).toEqual([0]);
  expect(values(0, 'over', 3000000.5)).toEqual([6000001]);
  expect(values(0, 'down', 3000000.5)).toEqual([0]);
  expect(values(1, 'up', 3000000.5)).toEqual([6000001]);
  expect(values(0, 'down', 3000001)).toEqual([1]);
  expect(values(0, 'up', 3000001)).toEqual([0]);
  expect(compiled).toBe(4);
  runtime.update([1]);
  runtime.update([0, 1]);
  expect(values(0, 'up', 3000001.5)).toEqual([0]);
  expect(compiled).toBe(6);
  for (const factory of [
    createExportButtonMovieRuntime,
    new Function(
      'return (' + createExportButtonMovieRuntime.toString() + ')',
    )() as typeof createExportButtonMovieRuntime,
  ]) {
    const aliased = factory(
      [data.buttons[0], data.buttons[1], data.buttons[0]],
      createMovieTreeRuntime,
      createMovieClock,
      data.buttonPlans,
    );
    const frames = (index: number, time: number, state: 'up' | 'down' = 'up') =>
      Object.values(aliased.sample(index, state, time));
    const continuity = new Map([
      [0, 'parent-lifetime'],
      [1, 'sibling-lifetime'],
    ]);
    aliased.update([0, 1], new Set(), continuity);
    continuity.clear(); // Runtime owns its snapshot.
    expect(frames(0, 0)).toEqual([0]);
    expect(frames(1, 0)).toEqual([0]);
    aliased.update(
      [2, 1],
      new Set([0]),
      new Map([
        [2, 'parent-lifetime'],
        [1, 'sibling-lifetime'],
      ]),
    );
    expect(frames(2, 0.5)).toEqual([1]);
    expect(frames(1, 0.5)).toEqual([1]);
    expect(frames(2, 0.5, 'down')).toEqual([0]);
    aliased.update(
      [0, 1],
      new Set(),
      new Map([
        [0, 'parent-lifetime'],
        [1, 'sibling-lifetime'],
      ]),
    );
    expect(frames(0, 1, 'down')).toEqual([1]);
    aliased.update(
      [0, 1],
      new Set(),
      new Map([
        [0, 'new-parent-lifetime'],
        [1, 'sibling-lifetime'],
      ]),
    );
    expect(frames(0, 1.5)).toEqual([0]);
    expect(frames(1, 1.5)).toEqual([3]);
    aliased.update([]);
    aliased.update([0], new Set(), new Map([[0, 'new-parent-lifetime']]));
    expect(frames(0, 2)).toEqual([0]);
  }
});

it('keeps exported static-container sibling clocks isolated across skipped root reentry', () => {
  const p = newProject();
  p.duration = 4;
  p.fps = 2;
  const art = {
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
  const leaf = {
    id: 'leaf',
    name: 'Leaf',
    width: 20,
    height: 20,
    shapes: [art],
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [{ ...art, fill: '#0000ff' }] },
        { frame: 2, shapes: [{ ...art, fill: '#00ff00' }] },
      ],
    },
  };
  const movie = symbolInstance(leaf, 40, 0);
  movie.symbolPlayback = { mode: 'movie' as const, firstFrame: 1 };
  const graphic = symbolInstance(leaf, 80, 0);
  graphic.symbolPlayback = { mode: 'loop' as const, firstFrame: 2 };
  const button = {
    id: 'button',
    name: 'Button',
    width: 20,
    height: 20,
    shapes: [art],
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
  };
  const wrapper = {
    id: 'wrapper',
    name: 'Static',
    width: 100,
    height: 20,
    shapes: [symbolInstance(button, 0, 0), movie, graphic],
  };
  p.symbols = [leaf, button, wrapper];
  const partial = symbolInstance(wrapper, 0, 0);
  const whole = symbolInstance(wrapper, 120, 0);
  p.layers[0].keys = [
    { frame: 0, shapes: [partial] },
    { frame: 2, shapes: [] },
  ];
  p.layers.push({ ...clone(p.layers[0]), id: 'whole', keys: [{ frame: 0, shapes: [whole] }] });
  const before = clone(p);
  const html = exportHTML(p);
  const data = JSON.parse(
    html.slice(html.indexOf('const p=') + 8, html.indexOf(',c=document.querySelector')),
  );
  const clocks = createMovieTreeRuntime(data.clockPlan, createMovieClock);
  const marker = (layer: number) => data.layers[layer].keys[0].shapes[1];
  const key = (layer: number) => data.layers[layer].id + '/' + marker(layer).id + '/leaf';
  expect(marker(0).id).toBe(partial.id + '/' + movie.id);
  expect(marker(1).id).toBe(whole.id + '/' + movie.id);
  expect(key(0)).not.toBe(key(1));
  expect(data.buttons.map((b: { instanceId: string }) => b.instanceId)).toEqual([
    partial.id + '/' + wrapper.shapes[0].id,
    whole.id + '/' + wrapper.shapes[0].id,
  ]);
  const colors = (position: number) => {
    const frames = clocks.sample(position % p.duration, position / p.fps, position);
    return [0, 1].map(
      (layer) => data.movieFrames[marker(layer).movie][frames[key(layer)] % 3][0].fill,
    );
  };
  expect(colors(0)).toEqual(['#0000ff', '#0000ff']);
  expect(colors(1)).toEqual(['#00ff00', '#00ff00']);
  // Ordinary movie clocks reconstruct the latest exposure age, unlike button pose sessions.
  expect(colors(6000005)).toEqual(['#00ff00', '#ff0000']);
  const advanced = clocks.sample(1, 3000002.5, 6000005);
  expect([advanced[key(0)], advanced[key(1)]]).toEqual([1, 6000005]);
  clocks.reset();
  expect(colors(0)).toEqual(['#0000ff', '#0000ff']);
  for (const layer of data.layers) {
    expect(layer.keys[0].shapes[2].fill).toBe('#00ff00');
    expect(layer.keys[0].shapes[2].movie).toBeUndefined();
  }
  expect(p).toEqual(before);
});

it.each([false, true])(
  'keeps pooled button definitions and lifetime origins distinct (serialized=%s)',
  (serialized) => {
    const p = newProject();
    p.fps = 2;
    const art = {
      id: 'red',
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
    const leaf = {
      id: 'leaf',
      name: 'Leaf',
      width: 20,
      height: 20,
      shapes: [art],
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [{ ...art, fill: '#0000ff' }] }] },
    };
    const movie = symbolInstance(leaf, 0, 0);
    movie.symbolPlayback = { mode: 'movie', firstFrame: 0 };
    const graphic = { id: 'graphic', name: 'Graphic', width: 20, height: 20, shapes: [movie] };
    const g = symbolInstance(graphic, 0, 0);
    const button = {
      id: 'b',
      name: 'Button',
      width: 20,
      height: 20,
      shapes: [g],
      buttonStates: { up: 0, over: 0, down: 1, hit: 1 },
      timeline: { duration: 2, keys: [{ frame: 1, shapes: [g] }] },
    };

    const other = {
      ...button,
      id: 'other-button',
      name: 'Other button',
      shapes: [g, symbolInstance(graphic, 30, 0)],
      timeline: { duration: 2, keys: [] },
    };
    p.symbols = [leaf, graphic, button, other];
    p.layers[0].keys[0].shapes = Array.from({ length: 8 }, (_, i) =>
      symbolInstance(i % 2 ? other : button, i * 70, 0),
    );
    const before = structuredClone(p),
      html = exportHTML(p);
    const data = JSON.parse(
      html.slice(html.indexOf('const p=') + 8, html.indexOf(',c=document.querySelector')),
    );
    expect(data.buttonPlans).toHaveLength(2);
    expect(data.buttons.map((b: { plans: number }) => b.plans)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
    const factory: typeof createExportButtonMovieRuntime = serialized
      ? new Function('return (' + createExportButtonMovieRuntime.toString() + ')')()
      : createExportButtonMovieRuntime;
    const runtime = factory(
      data.buttons,
      createMovieTreeRuntime,
      createMovieClock,
      data.buttonPlans,
    );
    runtime.update([0, 1, 2, 3, 4, 5, 6, 7]);
    const values = (i: number, state: 'up' | 'down', time: number) =>
      Object.values(runtime.sample(i, state, time));
    for (let i = 0; i < 8; i++) expect(values(i, 'up', 0)).toEqual(i % 2 ? [0, 0] : [0]);
    for (let i = 0; i < 8; i++)
      expect(values(i, 'up', 3000000.5)).toEqual(i % 2 ? [6000001, 6000001] : [6000001]);
    expect(values(1, 'down', 3000000.5)).toEqual([0, 0]);
    expect(values(3, 'up', 3000000.5)).toEqual([6000001, 6000001]);
    expect(values(0, 'up', 3000000.5)).toEqual([6000001]);
    expect(Object.values(runtime.origins(0))).toEqual([0]);
    expect(Object.values(runtime.origins(1))).toEqual([3000000.5, 3000000.5]);
    const snapshot = runtime.origins(0);
    snapshot[Object.keys(snapshot)[0]] = -1;
    expect(Object.values(runtime.origins(0))).toEqual([0]);
    runtime.prepare(0, 'state-parent');
    expect(values(0, 'up', 3000001)).toEqual([0]);
    runtime.prepare(2, 'state-parent');
    expect(values(2, 'up', 3000001.5)).toEqual([1]);
    // Parent discovery must not prune independent siblings before the full set is known.
    expect(values(3, 'up', 3000001.5)).toEqual([6000003, 6000003]);
    runtime.prepare(2, 'state-parent', true);
    expect(values(2, 'up', 3000002)).toEqual([0]);
    expect(Object.values(runtime.origins(2))).toEqual([3000002]);
    runtime.update([1]);
    expect(runtime.origins(0)).toEqual({});

    expect(p).toEqual(before);
  },
);

it('compiles nested button leaves once per mapped state while pooling definition plans', () => {
  const p = newProject();
  const art = {
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
  const child = {
    id: 'child',
    name: 'Child',
    width: 20,
    height: 20,
    shapes: [art],
    buttonStates: { up: 0, over: 0, down: 0, hit: 0 },
  };
  const hidden = { ...child, id: 'hidden', name: 'Hit only' };
  const parent = {
    id: 'parent',
    name: 'Parent',
    width: 20,
    height: 20,
    shapes: [symbolInstance(child, 0, 0)],
    buttonStates: { up: 0, over: 0, down: 1, hit: 2 },
    timeline: {
      duration: 3,
      keys: [
        { frame: 1, shapes: [] },
        { frame: 2, shapes: [symbolInstance(hidden, 0, 0)] },
      ],
    },
  };
  p.symbols = [child, hidden, parent];
  p.layers[0].keys[0].shapes = [symbolInstance(parent, 10, 10), symbolInstance(parent, 80, 10)];
  const before = clone(p),
    html = exportHTML(p);
  const data = JSON.parse(
    html.slice(html.indexOf('const p=') + 8, html.indexOf(',c=document.querySelector')),
  );
  expect(data.buttons).toHaveLength(4);
  expect(data.buttonPlans).toHaveLength(2);
  for (const index of [0, 2]) {
    const root = data.buttons[index],
      nested = data.buttons[index + 1];
    expect(root.poses.up).toEqual([{ button: index + 1 }]);
    expect(root.poses.over).toEqual(root.poses.up);
    expect(root.poses.down).toEqual([]);
    expect(root.poses.hit).toHaveLength(1);
    expect(nested.parent).toEqual({ index, frame: 0 });
    expect(nested.symbolId).toBe('child');
    expect(nested.poses.up[0].x).toBe(index === 0 ? 10 : 80);
  }
  expect(p).toEqual(before);
});
