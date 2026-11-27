import { it, expect } from 'vitest';
import {
  clone,
  newProject,
  newLayer,
  validateProject,
  type Vector,
} from '../packages/document/src';
import {
  distributeLayerArtwork,
  duplicateLayer,
  removeRootLayer,
  positionLayer,
  layerDisplay,
} from '../packages/animation/src/layers';
import {
  createBasicMotionSpan,
  refreshBasicMotionSpan,
} from '../packages/animation/src/motion-spans';
import { timelineScrollStep } from '../packages/animation/src/timeline';
it('duplicates layer identities consistently across keys without aliasing artwork', () => {
  const p = newProject(),
    s: Vector = {
      id: 'shape',
      groups: ['outer', 'inner'],
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
  p.layers[0].keys = [
    { frame: 0, shapes: [s] },
    { frame: 4, shapes: [clone(s)] },
  ];
  p.layers[0].locked = true;
  const old = clone(p.layers[0]);
  const next = duplicateLayer(p, old.id),
    d = p.layers.find((l) => l.id === next)!;
  expect(p.layers[0]).toEqual(old);
  expect(d.locked).toBe(false);
  expect(d.keys[0].shapes[0].id).not.toBe(s.id);
  expect(d.keys[0].shapes[0].id).toBe(d.keys[1].shapes[0].id);
  expect(d.keys[0].shapes[0].groups).not.toEqual(s.groups);
  expect(d.keys[0].shapes[0].groups).toEqual(d.keys[1].shapes[0].groups);
  d.keys[0].shapes[0].x = 50;
  expect(s.x).toBe(0);
  validateProject(p);
});
it('reorders whole layers and scopes visibility and locking without deleting keys', () => {
  const p = newProject();
  p.layers.push(newLayer('second'), newLayer('third'));
  const active = p.layers[1].id,
    keys = clone(p.layers[1].keys);
  positionLayer(p, active, 'top');
  expect(p.layers.at(-1)!.id).toBe(active);
  positionLayer(p, active, 'bottom');
  expect(p.layers[0].id).toBe(active);
  layerDisplay(p, active, 'solo');
  expect(p.layers.filter((l) => l.visible).map((l) => l.id)).toEqual([active]);
  layerDisplay(p, active, 'lockOthers');
  expect(p.layers[0].locked).toBe(false);
  expect(p.layers[1].locked).toBe(true);
  layerDisplay(p, active, 'show');
  layerDisplay(p, active, 'unlock');
  expect(p.layers.every((l) => l.visible && !l.locked)).toBe(true);
  expect(p.layers[0].keys).toEqual(keys);
  validateProject(p);
});
it('edge scrolling has a stationary middle and bounded endpoints', () => {
  expect(timelineScrollStep(50, 200, 600, 300)).toBe(50);
  expect(timelineScrollStep(50, 0, 600, 300)).toBe(47);
  expect(timelineScrollStep(50, 600, 600, 300)).toBe(53);
  expect(timelineScrollStep(0, -100, 600, 300)).toBe(0);
  expect(timelineScrollStep(267, 700, 600, 300)).toBe(267);
  expect(timelineScrollStep(0, 600, 600, 5)).toBe(0);
});

const paint = (name: string): Vector => ({
  id: name,
  kind: 'rectangle',
  x: 10,
  y: 20,
  width: 30,
  height: 40,
  rotation: 15,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
it('distributes full histories with outer groups, blank keys and detached artwork', () => {
  const p = newProject();
  p.duration = 10;
  p.folders = [{ id: 'folder', name: 'Folder' }];
  const a = paint('a'),
    b = { ...paint('b'), groups: ['outer', 'inner'] },
    c = { ...paint('c'), groups: ['outer'] };
  p.layers[0].folderId = 'folder';
  p.layers[0].drawingMode = 'object';
  p.layers[0].keys = [
    { frame: 0, shapes: [a, b, c] },
    { frame: 3, shapes: [] },
    { frame: 5, shapes: [{ ...a, x: 50 }, b, c] },
  ];
  const old = clone(p),
    source = p.layers[0];
  const ids = distributeLayerArtwork(p, source.id);
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(source.id);
  expect(p.duration).toBe(10);
  expect(p.layers.every((l) => l.folderId === 'folder' && l.drawingMode === 'object')).toBe(true);
  for (let k = 0; k < source.keys.length; k++) {
    expect(p.layers.flatMap((l) => l.keys[k].shapes)).toEqual(old.layers[0].keys[k].shapes);
    expect(p.layers.map((l) => l.keys[k].frame)).toEqual([
      source.keys[k].frame,
      source.keys[k].frame,
    ]);
  }
  expect(p.layers[1].keys[0].shapes.map((s) => s.id)).toEqual(['b', 'c']);
  p.layers[0].keys[0].shapes[0].x = 90;
  expect(a.x).toBe(10);
  validateProject(p);
});
it('derives a stable layer order from later keys and preserves absent artwork as blanks', () => {
  const p = newProject();
  const a = paint('a'),
    b = paint('b'),
    c = paint('c');
  p.layers[0].keys = [
    { frame: 0, shapes: [b] },
    { frame: 2, shapes: [a, b] },
    { frame: 4, shapes: [b, c] },
  ];
  distributeLayerArtwork(p, p.layers[0].id);
  expect(p.layers.map((l) => l.keys.flatMap((k) => k.shapes).map((s) => s.id))).toEqual([
    ['a'],
    ['b', 'b', 'b'],
    ['c'],
  ]);
  expect(p.layers[0].keys[0].shapes).toEqual([]);
});
it('rejects conflicting stacking order and changing group ownership atomically', () => {
  for (const kind of ['order', 'group']) {
    const p = newProject(),
      a = paint('a'),
      b = paint('b');
    p.layers[0].keys = [
      { frame: 0, shapes: [a, b] },
      { frame: 2, shapes: kind === 'order' ? [b, a] : [{ ...a, groups: ['new'] }, b] },
    ];
    const before = clone(p);
    expect(() => distributeLayerArtwork(p, p.layers[0].id)).toThrow(
      kind === 'order' ? 'stacking order' : 'changes groups',
    );
    expect(p).toEqual(before);
  }
});
it('keeps empty/single-unit layers unchanged and rejects protected layers without mutation', () => {
  const p = newProject();
  for (const shapes of [[], [paint('a')]]) {
    p.layers[0].keys[0].shapes = shapes;
    const before = clone(p);
    expect(distributeLayerArtwork(p, p.layers[0].id)).toEqual([p.layers[0].id]);
    expect(p).toEqual(before);
  }
  p.layers[0].locked = true;
  const before = clone(p);
  expect(() => distributeLayerArtwork(p, p.layers[0].id)).toThrow('unlocked');
  expect(p).toEqual(before);
});


it('validates original bindings before deleting a layer and removes only its channels', () => {
  const p = newProject(), first = p.layers[0], second = newLayer('second');
  p.layers.push(second);
  const shape: Vector = {id:'shared',kind:'rectangle',x:0,y:0,width:12,height:12,rotation:0,
    fill:'#ff0000',stroke:'#000000',strokeWidth:0,points:[]};
  for (const layer of p.layers) layer.keys[0].shapes = [clone(shape)];
  const binding = {layerId:first.id,shapeId:'shared',start:0,end:8,keys:[{frame:3,opacity:0.5}]};
  p.opacityBindings = [binding,{...clone(binding),layerId:second.id}];
  binding.keys[0].opacity = Infinity;
  const invalid = structuredClone(p);
  expect(() => removeRootLayer(p,first.id)).toThrow();
  expect(p).toEqual(invalid);
  binding.keys[0].opacity = 0.5;
  const survivor = clone(p.opacityBindings[1]);
  removeRootLayer(p,first.id);
  expect(p.layers).toEqual([second]);
  expect(p.opacityBindings).toEqual([survivor]);
  expect(() => removeRootLayer(p,second.id)).toThrow();
  p.layers.push(newLayer('third'));
  second.locked = true;
  expect(() => removeRootLayer(p,second.id)).toThrow();
  second.locked = false;
  removeRootLayer(p,second.id);
  expect(Object.prototype.hasOwnProperty.call(p,'opacityBindings')).toBe(false);
  validateProject(p);
});

for (const edited of [false, true])
  it(`duplicates opacity channels and preserves generated-key ownership (edited ${edited})`, () => {
    const p = newProject(),
      l = p.layers[0],
      other = newLayer('Other');
    p.layers.push(other);
    const art: Vector = {
      id: 'art',
      groups: ['g'],
      kind: 'rectangle',
      x: 10,
      y: 10,
      width: 20,
      height: 20,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#000000',
      strokeWidth: 0,
      points: [],
    };
    l.keys = [0, 4].map((frame) => ({ frame, shapes: [{ ...art, x: art.x + frame * 5 }] }));
    other.keys[0].shapes = [clone(art)];
    createBasicMotionSpan(p, [l.id], 0, 4, 'linear');
    if (edited) l.keys[2].shapes[0].y++;
    const channel = {
      layerId: l.id,
      shapeId: 'art',
      start: 0,
      end: 3,
      keys: [
        {
          frame: 0,
          opacity: 0.25,
          ease: { kind: 'cubic' as const, x1: 0.25, y1: 0, x2: 0.75, y2: 1 },
        },
      ],
    };
    p.opacityBindings = [
      channel,
      { ...clone(channel), layerId: other.id },
      { ...clone(channel), start: 4, end: 6, keys: [{ frame: 5, opacity: 0.5 }] },
    ];
    const original = clone(p);
    const copyId = duplicateLayer(p, l.id),
      copy = p.layers[1],
      shapeId = copy.keys[0].shapes[0].id;
    expect(copy.id).toBe(copyId);
    expect(copy.keys.every((k) => k.shapes[0].id === shapeId)).toBe(true);
    expect(shapeId).not.toBe(art.id);
    expect(p.opacityBindings.slice(3)).toEqual(
      [original.opacityBindings![0], original.opacityBindings![2]].map((b) => ({
        ...b,
        layerId: copyId,
        shapeId,
      })),
    );
    const copiedEase = p.opacityBindings[3].keys[0].ease;
    if (typeof copiedEase !== 'object') throw new Error('missing curve');
    copiedEase.y1 = 0.3;
    expect(p.opacityBindings.slice(0, 3)).toEqual(original.opacityBindings);
    if (edited)
      expect(() => refreshBasicMotionSpan(p, [copyId], 0, 4)).toThrow('Generated keys changed');
    else {
      copy.keys[4].shapes[0].x += 20;
      refreshBasicMotionSpan(p, [copyId], 0, 4);
      expect(copy.keys[2].shapes[0].x).toBe(l.keys[2].shapes[0].x + 10);
    }
    expect(l).toEqual(original.layers[0]);
    validateProject(p);
  });

it('rejects invalid original opacity data without publishing a duplicate', () => {
  const p = newProject(),
    l = p.layers[0];
  p.opacityBindings = [
    { layerId: l.id, shapeId: 'absent', start: 0, end: 4, keys: [{ frame: 2, opacity: NaN }] },
  ];
  const original = structuredClone(p);
  expect(() => duplicateLayer(p, l.id)).toThrow();
  expect(p).toEqual(original);
});


it('routes root opacity by stable output order across blank exposures and same-ID layers', () => {
  const p = newProject(), source = p.layers[0], other = newLayer('other');
  p.layers.push(other);
  const child = {...paint('child'), groups:['outer','inner']};
  const sibling = {...paint('sibling'), groups:['outer']};
  const back = paint('back');
  source.keys = [{frame:0,shapes:[child,sibling]}, {frame:2,shapes:[back,child,sibling]},
    {frame:5,shapes:[back]}, {frame:7,shapes:[back,child,sibling]}];
  other.keys[0].shapes = [paint('child')];
  const channel = {layerId:source.id,shapeId:'child',start:0,end:4,
    keys:[{frame:1,opacity:0.25,ease:{kind:'cubic' as const,x1:0.2,y1:0.3,x2:0.8,y2:0.9}}]};
  p.opacityBindings = [channel,{...clone(channel),layerId:other.id},
    {...clone(channel),start:7,end:9,keys:[{frame:8,opacity:0.8}]},
    {...clone(channel),shapeId:'back',start:2,end:9,keys:[{frame:5,opacity:1}]}];
  const before = clone(p);
  const [first,group] = distributeLayerArtwork(p,source.id);
  expect(first).toBe(source.id);
  expect(p.opacityBindings).toEqual(before.opacityBindings!.map(b =>
    b.layerId===source.id && b.shapeId==='child' ? {...b,layerId:group} : b));
  expect(p.layers[1].keys.map(k=>k.shapes)).toEqual([[child,sibling],[child,sibling],[],[child,sibling]]);
  expect(p.layers[2]).toEqual(before.layers[1]);
  validateProject(p);
});

it('rejects an invalid original bound exposure before cloning distributed artwork', () => {
  const p = newProject(), source = p.layers[0];
  source.keys[0].shapes = [paint('a'),paint('b')];
  p.opacityBindings = [{layerId:source.id,shapeId:'b',start:0,end:4,keys:[{frame:1,opacity:Infinity}]}];
  const before = structuredClone(p);
  expect(()=>distributeLayerArtwork(p,source.id)).toThrow();
  expect(p).toEqual(before);
});


it('distributes a remembered group and independent shape with refreshable recipes', () => {
  const p = newProject(), source = p.layers[0];
  const sourceArt = [paint('single'), {...paint('a'),groups:['g','inner']}, {...paint('b'),groups:['g']}];
  source.keys = [0,4].map(frame => ({frame,shapes:sourceArt.map((shape,i)=>({...shape,x:shape.x+frame*(i+1)}))}));
  source.keys.push({frame:7,shapes:[paint('later')]});
  createBasicMotionSpan(p,[source.id],0,4,'in');
  const recipe = clone(source.motionSpans![0]);
  const artwork = clone(source.keys);
  p.opacityBindings = [{layerId:source.id,shapeId:'a',start:0,end:4,keys:[{frame:1,opacity:0.6}]}];
  distributeLayerArtwork(p, source.id);
  const [single, group, outside] = p.layers;
  expect(single.motionSpans![0].id).toBe(recipe.id);
  expect(group.motionSpans![0].id).not.toBe(recipe.id);
  expect(outside.motionSpans).toBeUndefined();
  expect(p.opacityBindings[0].layerId).toBe(group.id);
  for (const layer of [single,group]) {
    expect(layer.motionSpans![0]).toEqual({...recipe,id:layer.motionSpans![0].id,baseline:JSON.stringify(layer.keys.slice(1,4))});
    refreshBasicMotionSpan(p,[layer.id],0,4);
  }
  for (let i=0;i<artwork.length;i++) expect(p.layers.flatMap(l=>l.keys[i].shapes)).toEqual(artwork[i].shapes);
  group.keys[4].shapes[0].x += 16;
  refreshBasicMotionSpan(p,[group.id],0,4);
  expect(group.keys[2].shapes[0].x).toBeGreaterThan(artwork[2].shapes[1].x);
  expect(single.keys[2].shapes).toEqual([artwork[2].shapes[0]]);
  validateProject(p);
});

for (const edit of ['interior','endpoint'] as const) it(`rejects distribution atomically for a later span with an edited ${edit}`, () => {
  const p = newProject(), layer = p.layers[0];
  layer.keys = [0,4,8].map(frame => ({frame,shapes:[{...paint('a'),x:frame},{...paint('b'),y:frame*2}]}));
  createBasicMotionSpan(p,[layer.id],0,4,'linear');
  createBasicMotionSpan(p,[layer.id],4,8,'linear');
  layer.keys[edit === 'interior' ? 6 : 8].shapes[1].y += 2;
  const before = clone(p);
  expect(()=>distributeLayerArtwork(p,layer.id)).toThrow(edit === 'interior' ? 'Generated keys changed' : 'reconstruct');
  expect(p).toEqual(before);
});


it('rejects a non-finite original interior even when JSON normalization would match the baseline', () => {
  const p = newProject(), source = p.layers[0];
  source.keys = [0,4].map(frame => ({frame,shapes:[paint('a'),{...paint('b'),x:frame}]}));
  createBasicMotionSpan(p,[source.id],0,4,'linear');
  Object.assign(source.keys[2],{extra: NaN});
  source.motionSpans![0].baseline = JSON.stringify(source.keys.slice(1,4));
  const original = structuredClone(p);
  expect(()=>distributeLayerArtwork(p,source.id)).toThrow('non-finite original');
  expect(p).toEqual(original);
});
