import { expect, it, vi } from 'vitest';
import { newProject, validateProject, type Vector } from '../packages/document/src';
import { copyVectors, ungroupVectors } from '../packages/document/src/groups';
import { groupDrawingPaint } from '../packages/geometry/src/symbols';
import { renderData } from '../packages/stage/src/render-data';
import { paintBoxBlur } from '../packages/stage/src/box-blur';
import { blendModes, type BlendMode } from '../packages/document/src/blend-modes';
import { validateSymbolMotionEffects } from '../packages/document/src/symbol-effects';
import { softwareBlend } from '../packages/stage/src/software-blend';

const shape: Vector = {
  id: 'paint',
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
  blurRadius: 4,
};

it('validates the persisted radius and retains prior drawings with no filter', () => {
  const p = newProject();
  for (const radius of [undefined, 1, 32]) {
    p.layers[0].keys[0].shapes = [{ ...shape, blurRadius: radius }];
    expect(validateProject(p)).toEqual(p);
  }
  for (const radius of [-1, 0, 0.5, 33, NaN, Infinity]) {
    p.layers[0].keys[0].shapes = [{ ...shape, blurRadius: radius }];
    expect(() => validateProject(p)).toThrow(/blur radius/);
  }
});

it('admits the last scratch pixel and rejects an excess before allocating or drawing', () => {
  const view = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
    translate() {
      return this;
    },
    rotate() {
      return this;
    },
  };
  const allocate = vi.fn(() => {
    throw Error('allocation reached');
  });
  const target = {
    canvas: { width: 20, height: 20, ownerDocument: { createElement: allocate } },
    getTransform: () => view,
  };
  const paint = vi.fn();
  const capacity = 64 * 1024 * 1024 - 400 - 3 * 28 * 28 - 8 * 28;
  const run = (pixels: number) =>
    paintBoxBlur(target as unknown as CanvasRenderingContext2D, renderData(shape), paint, pixels);
  expect(() => run(capacity + 1)).toThrow(/budget/);
  expect(allocate).not.toHaveBeenCalled();
  expect(() => run(capacity)).toThrow('allocation reached');
  Object.assign(target,{maskReservedPixels:capacity+1});
  expect(() => run(0)).toThrow(/budget/);
  expect(allocate).toHaveBeenCalledTimes(1);
  expect(paint).not.toHaveBeenCalled();
});

it('keeps isolated blur and source geometry intact when a Boolean merge is requested', async () => {
  const { mergeVectors } = await import('../packages/geometry/src/merge');
  const source = structuredClone(shape);
  expect(() => mergeVectors([source])).toThrow(/Remove drawing blur/);
  expect(source).toEqual(shape);
});

it.each(blendModes)('accepts %s on drawings, groups, and symbols', (blendMode) => {
  const project = newProject();
  project.symbols = [{ id: 'pair', name: 'Pair', width: 20, height: 20, shapes: [shape] }];
  const drawing = { ...shape, blendMode };
  const group = { ...shape, id: 'grouped', groups: ['group'], groupBlur: { group: 'group', radius: 0, blendMode } };
  const placed: Vector = { ...shape, id: 'placed', kind: 'symbol', symbolId: 'pair', blurRadius: undefined, instanceBlend: blendMode };
  project.layers[0].keys[0].shapes = [drawing, group, placed];
  expect(validateProject(project)).toEqual(project);
  expect(() => validateSymbolMotionEffects(placed)).not.toThrow();
});

it('rejects unknown drawing blends and retains the existing merge guard', async () => {
  const project = newProject();
  const art: Vector = {...shape, blendMode: 'multiply'};
  project.layers[0].keys[0].shapes = [art];
  const {mergeVectors}=await import('../packages/geometry/src/merge');
  expect(()=>mergeVectors([art])).toThrow(/Normal blending/);
  Object.assign(art,{blendMode:'unknown'});
  expect(()=>validateProject(project)).toThrow(/blend mode/);
});

it('validates a graphic instance radius independently of vector blur',()=>{
  const p=newProject();
  p.layers[0].drawingMode='object';
  p.symbols=[{id:'pair',name:'Pair',width:20,height:20,shapes:[shape]}];
  const placed:Vector={...shape,kind:'symbol',symbolId:'pair',blurRadius:undefined,instanceBlur:32};
  p.layers[0].keys[0].shapes=[placed];
  expect(validateProject(p)).toEqual(p);
  for(const radius of [0,-1,.5,33,Infinity,NaN]){
    placed.instanceBlur=radius;
    expect(()=>validateProject(p)).toThrow(/symbol blur radius/);
  }
  p.layers[0].keys[0].shapes=[{...shape,instanceBlur:1}];
  expect(()=>validateProject(p)).toThrow(/symbol blur radius/);
});

it('accounts for the enclosing raster before allocating a graphic group tile',()=>{
  const tile=vi.fn(()=>{throw Error('Unexpected allocation')});
  const target={canvas:{width:100,height:80,ownerDocument:{createElement:tile}},
    getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),maskReservedPixels:64*1024*1024-8000};
  expect(()=>paintBoxBlur(target as unknown as CanvasRenderingContext2D,
    {blurRadius:2,opacity:.5,worldBounds:{left:0,right:20,top:0,bottom:20}},()=>{},0)).toThrow(/budget/);
  expect(tile).not.toHaveBeenCalled();
});

it('keeps copied group blur local and removes it on ungroup',()=>{
  const a={...shape,groups:['pair'],groupBlur:{group:'pair',radius:4}};
  const b={...a,id:'second'};
  const copies=copyVectors([a,b],0);
  expect(copies[0].groupBlur?.group).toBe(copies[0].groups[0]);
  expect(copies[0].groups[0]).not.toBe('pair');
  expect(groupDrawingPaint([a,b,...copies])).toHaveLength(2);
  ungroupVectors(copies,[copies[0].id],[]);
  expect(copies.every(s=>!s.groupBlur)).toBe(true);
  expect(a.groupBlur).toEqual({group:'pair',radius:4});
  const p=newProject();
  for(const radius of [0,NaN,Infinity,1.25,33]){
    p.layers[0].keys[0].shapes=[{...a,groupBlur:{group:'pair',radius}}];
    expect(()=>validateProject(p)).toThrow(/group blur/);
  }
});

it('accepts placement blends only for symbol instances and rejects unknown modes',()=>{
  const project=newProject(),art={...shape,blurRadius:undefined};
  project.symbols=[{id:'pair',name:'Pair',width:20,height:20,shapes:[art]}];
  const placed:Vector={...art,kind:'symbol',symbolId:'pair',instanceBlend:'screen'};
  project.layers[0].keys[0].shapes=[placed];
  expect(validateProject(project)).toEqual(project);
  Object.assign(placed,{instanceBlend:'unknown'});
  expect(()=>validateProject(project)).toThrow(/symbol blend mode/);
  expect(()=>validateSymbolMotionEffects(placed)).toThrow(/symbol motion blend mode/);
  project.layers[0].keys[0].shapes=[{...art,instanceBlend:'multiply'}];
  expect(()=>validateProject(project)).toThrow(/symbol blend mode/);
});

const softwareCases: [BlendMode, number[]][] = [
  ['linear-burn', [1, 0, 65]], ['darker-color', [192, 80, 96]],
  ['linear-dodge', [255, 208, 255]], ['lighter-color', [64, 128, 224]],
  ['vivid-light', [130, 53, 214]], ['linear-light', [193, 33, 161]],
  ['pin-light', [129, 128, 192]], ['hard-mix', [255, 0, 255]],
  ['subtract', [0, 48, 128]], ['divide', [85, 255, 255]],
];

it.each(softwareCases)('%s blends color without changing source alpha or the backdrop', (mode, expected) => {
  const source = new Uint8ClampedArray([192, 80, 96, 127, 192, 80, 96, 127, 0, 0, 0, 0]);
  const backdrop = new Uint8ClampedArray([64, 128, 224, 255, 0, 0, 0, 0, 64, 128, 224, 255]);
  const originalBackdrop = backdrop.slice();
  softwareBlend(mode)!(source, backdrop);
  expect([...source]).toEqual([...expected, 127, 192, 80, 96, 127, 0, 0, 0, 0]);
  expect(backdrop).toEqual(originalBackdrop);
});

it('weights the blended source color by backdrop opacity', () => {
  const source = new Uint8ClampedArray([192, 80, 96, 128]);
  softwareBlend('subtract')!(source, new Uint8ClampedArray([64, 128, 224, 128]));
  expect([...source]).toEqual([96, 64, 112, 128]);
});

it('charges for the two software blend readbacks before allocating', () => {
  const allocate = vi.fn(() => { throw Error('allocation reached'); });
  const target = {
    canvas: { width: 20, height: 20, ownerDocument: { createElement: allocate } },
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1 }),
  } as unknown as CanvasRenderingContext2D;
  const paint = (decoded: number) =>
    paintBoxBlur(target, { blurRadius: 0, opacity: 1, blendMode: 'linear-dodge' }, vi.fn(), decoded);
  const available = 64 * 1024 * 1024 - 4 * 400;
  expect(() => paint(available + 1)).toThrow(/budget/);
  expect(allocate).not.toHaveBeenCalled();
  expect(() => paint(available)).toThrow('allocation reached');
});

it('validates group blend and blur independently and copies their shared owner',()=>{
  const p=newProject(), a:Vector={...shape,groups:['pair'],groupBlur:{group:'pair',radius:0,blendMode:'screen'}};
  const b={...a,id:'second'};
  p.layers[0].keys[0].shapes=[a,b];
  expect(validateProject(p)).toEqual(p);
  const copies=copyVectors([a,b],0);
  expect(groupDrawingPaint(copies)).toMatchObject([{kind:'masked-symbol',drawingGroup:true,blurRadius:0,blendMode:'screen'}]);
  expect(copies[0].groupBlur?.group).toBe(copies[0].groups[0]);
  Object.assign(a.groupBlur!,{blendMode:'bad'});
  expect(()=>validateProject(p)).toThrow(/group blur/);
  Object.assign(a.groupBlur!,{blendMode:'multiply',radius:-1});
  expect(()=>validateProject(p)).toThrow(/group blur/);
});

it('admits finite symbol tint amounts with RGB colors, including dormant zero strength',()=>{
  const project=newProject(), art={...shape,blurRadius:undefined};
  project.symbols=[{id:'pair',name:'Pair',width:20,height:20,shapes:[art]}];
  const instance:Vector={...art,kind:'symbol',symbolId:'pair'};
  project.layers[0].keys[0].shapes=[instance];
  for(const amount of [0,.5,1]){
    instance.instanceTint={color:'#00Ff80',amount};
    expect(validateProject(project)).toEqual(project);
  }
  for(const tint of [{color:'#fff',amount:1},{color:'#ffffff80',amount:1},
    ...[-1,1.01,NaN,Infinity].map(amount=>({color:'#ffffff',amount}))]){
    instance.instanceTint=tint;
    expect(()=>validateProject(project)).toThrow(/symbol tint/);
  }
  project.layers[0].keys[0].shapes=[{...art,instanceTint:{color:'#ffffff',amount:.5}}];
  expect(()=>validateProject(project)).toThrow(/symbol tint/);
});

it('charges the additional tint readback even when blur is zero',()=>{
  const allocate=vi.fn(()=>{throw Error('allocation reached');});
  const target={canvas:{width:20,height:20,ownerDocument:{createElement:allocate}},
    getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0})} as unknown as CanvasRenderingContext2D;
  const apply=(decoded:number)=>paintBoxBlur(target,{blurRadius:0,opacity:1,tint:{color:'#abcdef',amount:.25}},vi.fn(),decoded);
  const available=64*1024*1024-3*400;
  expect(()=>apply(available+1)).toThrow(/budget/);
  expect(allocate).not.toHaveBeenCalled();
  expect(()=>apply(available)).toThrow('allocation reached');
});

it('rejects malformed drawing and group tints and preserves the original paint during conversion',async()=>{
  const p=newProject(),art:Vector={...shape,blurRadius:undefined,tint:{color:'#0099ff',amount:.25}};
  p.layers[0].keys[0].shapes=[art];
  expect(validateProject(p)).toEqual(p);
  const {mergeVectors}=await import('../packages/geometry/src/merge');
  expect(()=>mergeVectors([art])).toThrow(/Remove drawing tint/);
  expect(art.fill).toEqual(shape.fill);
  for(const tint of [{color:'#fff',amount:.5},{color:'#123456',amount:NaN},{color:'#123456',amount:1.01}]){
    p.layers[0].keys[0].shapes=[{...art,tint}];expect(()=>validateProject(p)).toThrow(/drawing tint/);
    p.layers[0].keys[0].shapes=[{...art,groups:['pair'],groupBlur:{group:'pair',radius:0,tint}}];
    expect(()=>validateProject(p)).toThrow(/group blur/);
  }
  const dormant={...art,groups:['pair'],groupBlur:{group:'pair',radius:0,tint:{color:'#00ff00',amount:0}}};
  expect(groupDrawingPaint([dormant])).toEqual([dormant]);
});
