import { editSymbolBasicMotionSpan } from '../packages/animation/src/motion-spans';
import { it, expect } from 'vitest';
import {
  newProject,
  MAX_SYMBOL_ARTWORK,
  clone,
  symbolLayers,
  validateProject,
  type SymbolDefinition,
  type Vector,
} from '../packages/document/src';
import {
  expandSymbols,
  symbolInstance,
  symbolUsed,
  updateSymbolTimeline,
} from '../packages/geometry/src/symbols';
import {
  distributeSymbolArtwork,
  transferSymbolKey,
  copySymbolFrames,
  insertSymbolFrames,
  duplicateSymbolLayer,
} from '../packages/animation/src/symbol-timeline';
const art = (fill: string): Vector => ({
  id: 'art',
  kind: 'rectangle',
  x: 0,
  y: 0,
  width: 30,
  height: 20,
  rotation: 0,
  fill,
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
  groups: ['group'],
});
function fixture() {
  const p = newProject();
  const child: SymbolDefinition = {
    id: 'child',
    name: 'Child',
    width: 30,
    height: 20,
    shapes: [art('#ff0000')],
    timeline: { duration: 2, keys: [{ frame: 1, shapes: [art('#0000ff')] }] },
  };
  const def: SymbolDefinition = {
    id: 'parent',
    name: 'Parent',
    width: 30,
    height: 20,
    shapes: [art('#00ff00')],
    timeline: {
      duration: 5,
      keys: [],
      layers: [
        {
          id: 'overlay',
          name: 'Overlay',
          visible: true,
          locked: false,
          keys: [
            { frame: 0, shapes: [] },
            { frame: 2, shapes: [symbolInstance(child, 0, 0)] },
          ],
        },
      ],
    },
  };
  p.symbols = [def, child];
  const instance = symbolInstance(def, 100, 100);
  p.layers[0].keys[0].shapes = [instance];
  return { p, def, child, instance };
}
it('evaluates independent symbol layer exposures, nested local ages, visibility and namespaced identities', () => {
  const { p, def, instance } = fixture();
  expect(validateProject(p)).toEqual(p);
  expect(expandSymbols(p, [instance], 1).map((s) => s.fill)).toEqual(['#00ff00']);
  expect(expandSymbols(p, [instance], 2).map((s) => s.fill)).toEqual(['#00ff00', '#ff0000']);
  expect(expandSymbols(p, [instance], 3).map((s) => s.fill)).toEqual(['#00ff00', '#0000ff']);
  const layered = expandSymbols(p, [instance], 3);
  expect(layered[1].id).toContain('/overlay/');
  expect(layered[1].groups![0]).toContain('/overlay/');
  def.timeline!.layers![0].locked = true;
  expect(expandSymbols(p, [instance], 3)).toHaveLength(2);
  def.timeline!.layers![0].visible = false;
  expect(expandSymbols(p, [instance], 3)).toHaveLength(1);
  expect(symbolUsed(p, 'child')).toBe(true);
});
it('copies and moves only the active symbol layer while preserving the other tracks', () => {
  const { def } = fixture();
  const before = structuredClone(def);
  const moved = transferSymbolKey(def, 2, 7, true, 'overlay');
  expect(moved.timeline?.duration).toBe(8);
  expect(moved.timeline?.layers?.[0].keys.map((k) => k.frame)).toEqual([0, 7]);
  expect(moved.shapes).toEqual(def.shapes);
  expect(def).toEqual(before);
  const base = transferSymbolKey(def, 0, 1);
  expect(base.timeline?.layers).toEqual(def.timeline?.layers);
  def.timeline!.layers![0].locked = true;
  expect(() => transferSymbolKey(def, 2, 3, false, 'overlay')).toThrow('unlocked');
});
it('validates hidden symbol layer references, ordering, duration and cycles atomically', () => {
  const { p, def } = fixture();
  const before = structuredClone(p);
  const draft = structuredClone(def);
  draft.timeline!.layers![0].visible = false;
  draft.timeline!.layers![0].keys[1].shapes = [symbolInstance(def, 0, 0)];
  expect(() => updateSymbolTimeline(p, def.id, draft)).toThrow('cycle');
  expect(p).toEqual(before);
  draft.timeline!.layers![0].keys[1].shapes = [];
  draft.timeline!.duration = 2;
  expect(() => updateSymbolTimeline(p, def.id, draft)).toThrow('ordering');
  expect(p).toEqual(before);
  draft.timeline!.duration = 5;
  draft.timeline!.layers![0].id = '@base';
  expect(() => updateSymbolTimeline(p, def.id, draft)).toThrow('symbol layer');
});

it('duplicates full symbol tracks with consistent fresh shape/group IDs and independent contents', () => {
  const { def } = fixture();
  def.timeline!.keys = [{ frame: 1, shapes: structuredClone(def.shapes) }];
  const before = structuredClone(def),
    result = duplicateSymbolLayer(def, '@base');
  expect(def).toEqual(before);
  const copied = result.definition.timeline!.layers![0];
  expect(copied.id).toBe(result.layerId);
  expect(copied.name).toBe('Artwork copy');
  expect(copied.keys[0].shapes[0].id).not.toBe(def.shapes[0].id);
  expect(copied.keys[0].shapes[0].id).toBe(copied.keys[1].shapes[0].id);
  expect(copied.keys[0].shapes[0].groups).toEqual(copied.keys[1].shapes[0].groups);
  expect(copied.keys[0].shapes[0].groups).not.toEqual(def.shapes[0].groups);
  copied.keys[0].shapes[0].fill = '#ffffff';
  expect(def).toEqual(before);
  def.timeline!.layers![0].locked = true;
  expect(() => duplicateSymbolLayer(def, 'overlay')).toThrow('unlocked');
});
it('transfers keys across symbol layers atomically with fresh identities and protected destinations', () => {
  const { def } = fixture(),
    before = structuredClone(def);
  const copied = transferSymbolKey(def, 0, 1, false, '@base', 'overlay');
  const paint = copied.timeline!.layers![0].keys[1].shapes[0];
  expect(paint.id).not.toBe(def.shapes[0].id);
  expect(paint.fill).toBe(def.shapes[0].fill);
  expect(copied.shapes).toEqual(def.shapes);
  expect(def).toEqual(before);
  const moved = transferSymbolKey(def, 2, 2, true, 'overlay', '@base');
  expect(moved.timeline!.layers![0].keys).toHaveLength(1);
  expect(moved.timeline!.keys[0].frame).toBe(2);
  expect(moved.timeline!.keys[0].shapes[0].symbolId).toBe('child');
  expect(() => transferSymbolKey(def, 0, 2, false, '@base', 'overlay')).toThrow('contains');
  expect(() => transferSymbolKey(def, 0, 1, false, '@base', 'missing')).toThrow('unlocked');
  def.timeline!.layers![0].visible = false;
  expect(() => transferSymbolKey(def, 0, 1, false, '@base', 'overlay')).toThrow('unlocked');
  expect(before.timeline!.layers![0].keys).toHaveLength(2);
});

it('distributes base symbol artwork while preserving groups, blanks, mappings and linked playback', () => {
  const { p, def, child, instance } = fixture();
  const a = { ...art('#ff0000'), id: 'a', groups: undefined };
  const b = { ...art('#0000ff'), id: 'b', groups: ['outer', 'inner'] };
  const c = { ...symbolInstance(child, 20, 10), groups: ['outer'] };
  def.shapes = [a, b, c];
  def.timeline!.keys = [
    { frame: 2, shapes: [] },
    { frame: 3, shapes: [{ ...a, x: 15 }, b, c] },
  ];
  def.buttonStates = { up: 0, over: 1, down: 3, hit: 4 };
  const before = clone(def);
  const result = distributeSymbolArtwork(def, '@base');
  expect(def).toEqual(before);
  expect(result.buttonStates).toEqual(def.buttonStates);
  expect(result.timeline!.duration).toBe(5);
  expect(result.timeline!.layers).toHaveLength(2);
  expect(result.timeline!.layers![1]).toEqual(def.timeline!.layers![0]);
  const layers = symbolLayers(result);
  for (let i = 0; i < 3; i++)
    expect(layers.slice(0, 2).flatMap((l) => l.keys[i].shapes)).toEqual(
      symbolLayers(def)[0].keys[i].shapes,
    );
  for (let frame = 0; frame < 5; frame++) {
    const expected = expandSymbols(p, [instance], frame);
    p.symbols![0] = result;
    const prefix = instance.id + '/' + result.timeline!.layers![0].id + '/';
    const actual = expandSymbols(p, [instance], frame);
    // Authoring identities stay fixed; rendered namespaces include the new owning track.
    expect(
      actual.map((shape) => ({
        ...shape,
        id: shape.id.replace(prefix, instance.id + '/'),
        ...(shape.groups
          ? { groups: shape.groups.map((g) => g.replace(prefix, instance.id + '/')) }
          : {}),
      })),
    ).toEqual(expected);
    p.symbols![0] = def;
  }
  p.symbols![0] = result;
  validateProject(p);
});
it('distributes an extra track at its original position without changing base artwork', () => {
  const { def } = fixture();
  const track = def.timeline!.layers![0];
  track.keys[1].shapes.push({ ...art('#ff0000'), id: 'second', groups: undefined });
  const old = clone(def),
    result = distributeSymbolArtwork(def, track.id);
  expect(result.shapes).toEqual(old.shapes);
  expect(result.timeline!.keys).toEqual(old.timeline!.keys);
  expect(result.timeline!.layers![0].id).toBe(track.id);
  expect(result.timeline!.layers).toHaveLength(2);
  expect(result.timeline!.layers!.every((l) => !l.keys[0].shapes.length)).toBe(true);
  expect(result.timeline!.layers!.flatMap((l) => l.keys[1].shapes)).toEqual(track.keys[1].shapes);
  expect(def).toEqual(old);
});
it('admits distribution that empties initial Artwork and keeps single-unit static definitions unchanged', () => {
  const { def } = fixture();
  const a = { ...art('#ff0000'), id: 'a', groups: undefined },
    b = { ...a, id: 'b' };
  def.shapes = [b];
  def.timeline!.keys = [{ frame: 2, shapes: [a, b] }];
  const before = clone(def);
  const distributed = distributeSymbolArtwork(def, '@base');
  expect(distributed.shapes).toEqual([]);
  expect(distributed.timeline!.layers!.some(l => l.keys[0].shapes[0]?.id === b.id)).toBe(true);
  expect(def).toEqual(before);
  delete def.timeline;
  expect(distributeSymbolArtwork(def, '@base')).toEqual(def);
});
it('rejects protected tracks and changing order without touching source data', () => {
  const { def } = fixture();
  const track = def.timeline!.layers![0];
  track.locked = true;
  const before = clone(def);
  expect(() => distributeSymbolArtwork(def, track.id)).toThrow('unlocked');
  expect(def).toEqual(before);
  track.locked = false;
  const a = { ...art('#ff0000'), id: 'a', groups: undefined },
    b = { ...a, id: 'b' };
  track.keys = [
    { frame: 0, shapes: [a, b] },
    { frame: 2, shapes: [b, a] },
  ];
  const ordered = clone(def);
  expect(() => distributeSymbolArtwork(def, track.id)).toThrow('stacking order');
  expect(def).toEqual(ordered);
});

it('rejects over-capacity symbol distribution before replacing any track', () => {
  const { def } = fixture();
  def.shapes = [
    { ...art('#ff0000'), id: 'a', groups: undefined },
    { ...art('#0000ff'), id: 'b', groups: undefined },
  ];
  def.timeline!.layers = Array.from({ length: 127 }, (_, i) => ({
    id: 'layer' + i,
    name: 'Layer ' + i,
    visible: true,
    locked: false,
    keys: [{ frame: 0, shapes: [] }],
  }));
  const before = clone(def);
  expect(() => distributeSymbolArtwork(def, '@base')).toThrow('layer capacity');
  expect(def).toEqual(before);
});


for (const track of ['@base','overlay']) it(`partitions remembered ${track} motion using the nested graphic clock`, () => {
  const {p,def,child} = fixture();
  const linked = {...symbolInstance(child,20,10),id:'graphic',groups:['outer']};
  const poses = [0,4].map(frame=>({frame,shapes:[{...art('#ff0000'),id:'solo',groups:[],x:frame*4},
    {...linked,x:20+frame*3}]}));
  if (track==='@base') {
    def.shapes = poses[0].shapes;
    def.timeline!.keys = poses.slice(1);
  } else def.timeline!.layers![0].keys = poses;
  def.buttonStates = {up:0,over:1,down:3,hit:4};
  const source = editSymbolBasicMotionSpan(def,[track],0,4,'create','linear',p.symbols);
  const before = clone(source), original = symbolLayers(source).find(l=>l.id===track)!;
  const result = distributeSymbolArtwork(source,track,p.symbols);
  expect(result.buttonStates).toEqual(source.buttonStates);
  const tracks = symbolLayers(result), index = tracks.findIndex(l=>l.id===track);
  const [solo,graphic] = tracks.slice(index,index+2);
  expect(solo.motionSpans![0].id).toBe(original.motionSpans![0].id);
  expect(graphic.motionSpans![0].id).not.toBe(solo.motionSpans![0].id);
  for (const [i,key] of original.keys.entries())
    expect([...solo.keys[i].shapes,...graphic.keys[i].shapes]).toEqual(key.shapes);
  expect(graphic.keys[1].shapes[0].symbolPlayback?.firstFrame).toBe(1);
  const refreshed = editSymbolBasicMotionSpan(result,[solo.id,graphic.id],0,4,'refresh','linear',p.symbols);
  expect(symbolLayers(refreshed)).toEqual(tracks);
  expect(source).toEqual(before);
});

it('rejects an over-budget library or stale original interior without modifying the symbol', () => {
  const {p,def} = fixture();
  def.shapes = [art('#ff0000'),{...art('#00ff00'),id:'other',groups:[]}];
  def.timeline!.keys = [{frame:4,shapes:def.shapes.map(s=>({...s,x:30}))}];
  const source = editSymbolBasicMotionSpan(def,['@base'],0,4,'create','linear',p.symbols);
  const before = clone(source);
  const full = {id:'full',name:'Full',width:20,height:20,shapes:Array(MAX_SYMBOL_ARTWORK).fill(art('#0000ff'))};
  expect(()=>distributeSymbolArtwork(source,'@base',[...p.symbols!,full])).toThrow('symbol artwork budget');
  expect(source).toEqual(before);
  source.timeline!.keys[1].shapes[0].x++;
  const stale = clone(source);
  expect(()=>distributeSymbolArtwork(source,'@base',p.symbols)).toThrow('Generated keys changed');
  expect(source).toEqual(stale);
});

it('rejects a distributed symbol when the new tracks together exceed nested expansion capacity', () => {
  const ink = art('#ff0000');
  const library: SymbolDefinition[] = [{id:'leaf',name:'Leaf',width:20,height:20,
    shapes:Array.from({length:60},(_,i)=>({...ink,id:String(i),groups:[]}))}];
  for (let level=1;level<=3;level++) {
    const child = library[level-1];
    library.push({id:'level'+level,name:'Level '+level,width:20,height:20,
      shapes:Array.from({length:10},()=>symbolInstance(child,0,0))});
  }
  const heavy = library[3];
  const owner: SymbolDefinition = {id:'owner',name:'Owner',width:20,height:20,
    shapes:[ink],timeline:{duration:7,keys:[
      {frame:4,shapes:[{...ink,x:10}]},
      {frame:5,shapes:[{...symbolInstance(heavy,0,0),id:'first'}]},
      {frame:6,shapes:[{...symbolInstance(heavy,0,0),id:'second'}]},
    ]}};
  const source = editSymbolBasicMotionSpan(owner,['@base'],0,4,'create','linear',[...library,owner]);
  const project = newProject();
  project.symbols = [...library,source];
  validateProject(project);
  const original = clone(project);
  expect(()=>distributeSymbolArtwork(source,'@base',project.symbols)).toThrow('nested symbol expansion budget');
  expect(()=>duplicateSymbolLayer(source,'@base',project.symbols)).toThrow('nested symbol expansion budget');
  const withOverlay = clone(source);
  withOverlay.timeline!.layers = [{id:'overlay',name:'Overlay',visible:true,locked:false,keys:[{frame:0,shapes:[]}]}];
  const clip = copySymbolFrames(withOverlay,'@base',0,5,project.symbols);
  const beforePaste = clone(withOverlay);
  expect(()=>insertSymbolFrames(withOverlay,'overlay',7,clip,project.symbols)).toThrow('nested symbol expansion budget');
  expect(withOverlay).toEqual(beforePaste);
  expect(project).toEqual(original);
});

for (const track of ['@base','overlay']) for (const edited of [false,true])
  it(`duplicates ${track} motion with independent refreshed keys and edited interior protection (${edited})`, () => {
    const {p,def,child} = fixture();
    const linked = {...symbolInstance(child,20,10),id:'linked',groups:['outer','inner']};
    const poses = [0,4].map(frame=>({frame,shapes:[{...linked,x:20+frame*5}]}));
    if (track==='@base') {
      def.shapes = poses[0].shapes;
      def.timeline!.keys = poses.slice(1);
    } else def.timeline!.layers![0].keys = poses;
    def.buttonStates = {up:0,over:1,down:3,hit:4};
    const source = editSymbolBasicMotionSpan(def,[track],0,4,'create','linear',p.symbols);
    const originalTrack = symbolLayers(source).find(l=>l.id===track)!;
    if (edited) originalTrack.keys[2].shapes[0].y++;
    const before = clone(source);
    const {definition:duplicate,layerId} = duplicateSymbolLayer(source,track,p.symbols);
    const copy = symbolLayers(duplicate).find(l=>l.id===layerId)!;
    expect(duplicate.buttonStates).toEqual(before.buttonStates);
    expect(copy.keys[0].shapes[0].groups![0]).not.toBe('outer');
    for (const [i,k] of copy.keys.entries()) {
      expect(k.shapes[0].id).toBe(copy.keys[0].shapes[0].id);
      expect(k.shapes[0].id).not.toBe('linked');
      expect(k.shapes[0]).toEqual({...originalTrack.keys[i].shapes[0],id:k.shapes[0].id,groups:copy.keys[0].shapes[0].groups});
    }
    const refresh = () => editSymbolBasicMotionSpan(duplicate,[layerId],0,4,'ease','in',p.symbols);
    if (edited) expect(refresh).toThrow('Generated keys changed');
    else {
      expect(copy.motionSpans![0].baseline).toBe(JSON.stringify(copy.keys.slice(1,4)));
      const revised = refresh();
      expect(symbolLayers(revised).find(l=>l.id===track)).toEqual(originalTrack);
      expect(symbolLayers(revised).find(l=>l.id===layerId)!.keys[2].shapes[0].x).toBeLessThan(originalTrack.keys[2].shapes[0].x);
    }
    expect(source).toEqual(before);
  });

it('checks aggregate replacement capacity and original values before copying a motion track', () => {
  const {p,def} = fixture();
  def.timeline!.keys = [{frame:4,shapes:def.shapes.map(shape=>({...shape,x:40}))}];
  const source = editSymbolBasicMotionSpan(def,['@base'],0,4,'create','linear',p.symbols);
  const before = clone(source);
  // Eight source/library shapes and five more on duplication exceed the budget together.
  const full = {id:'other',name:'Other',width:20,height:20,shapes:Array(MAX_SYMBOL_ARTWORK-10).fill(art('#ff0000'))};
  expect(()=>duplicateSymbolLayer(source,'@base',[...p.symbols!,full])).toThrow('symbol artwork budget');
  expect(source).toEqual(before);
  Object.assign(source.timeline!.keys[1],{extra:Infinity});
  source.timeline!.motionSpans![0].baseline = JSON.stringify(source.timeline!.keys.slice(0,3));
  const invalid = structuredClone(source);
  expect(()=>duplicateSymbolLayer(source,'@base',p.symbols)).toThrow('non-finite original');
  expect(source).toEqual(invalid);
});
