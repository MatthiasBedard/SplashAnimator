import { rangeHandleTransform } from '../packages/geometry/src/range-handles';
import { matrix, mapPoint } from '../packages/geometry/src/affine';
import { objectBounds } from '../packages/geometry/src/layout';
import { it, expect } from 'vitest';
import {
  editSymbolChildren,
  isolateSymbolGroup,
  replaceSymbolGroup,
  copySymbolChildren,
  pasteSymbolChildren,
  moveSymbolChildren,
  transformSymbolChildren,
  symbolTransformPivot,
  symbolTransformBounds,
  affineSymbolChildren,
  drawnSymbolPrimitive,
} from '../packages/geometry/src/symbol-artwork';
import { newProject, validateProject, type Vector } from '../packages/document/src';
import { symbolInstance } from '../packages/geometry/src/symbols';
const shape = (id: string, groups?: string[]): Vector => ({
  id,
  groups,
  kind: 'rectangle',
  x: 2,
  y: 3,
  width: 40,
  height: 30,
  rotation: 15,
  transform: [1, 0.2, 0.3, 1],
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 0,
  points: [],
});
it('duplicates a complete symbol child group with independent identities and preserved affine paint', () => {
  const art = [
    shape('below'),
    shape('a', ['outer', 'inner']),
    shape('b', ['outer', 'inner']),
    shape('c', ['outer']),
    shape('above'),
  ];
  const before = structuredClone(art);
  const result = editSymbolChildren(art, 'b', 'duplicate');
  expect(art).toEqual(before);
  expect(result.artwork.map((s) => s.id).slice(0, 4)).toEqual(['below', 'a', 'b', 'c']);
  const copies = result.artwork.slice(4, 7);
  expect(result.selected).toBe(copies[1].id);
  expect(new Set(result.artwork.map((s) => s.id)).size).toBe(8);
  expect(copies[0].groups).toEqual(copies[1].groups);
  expect(copies[2].groups).toEqual([copies[0].groups![0]]);
  expect(copies[0].groups![0]).not.toBe('outer');
  expect(copies[0].groups![1]).not.toBe('inner');
  expect(copies[0]).toMatchObject({ x: 12, y: 13, transform: art[1].transform, fill: art[1].fill });
  copies[0].transform![0] = 4;
  expect(art).toEqual(before);
});
it('removes and reorders complete outer groups without changing their internal stack', () => {
  const art = [
    shape('below'),
    shape('a', ['outer', 'inner']),
    shape('b', ['outer']),
    shape('above'),
  ];
  expect(editSymbolChildren(art, 'a', 'front').artwork.map((s) => s.id)).toEqual([
    'below',
    'above',
    'a',
    'b',
  ]);
  expect(editSymbolChildren(art, 'b', 'back').artwork.map((s) => s.id)).toEqual([
    'a',
    'b',
    'below',
    'above',
  ]);
  expect(editSymbolChildren(art, 'a', 'delete').artwork.map((s) => s.id)).toEqual([
    'below',
    'above',
  ]);
  expect(editSymbolChildren([shape('only')], 'only', 'delete')).toEqual({
    artwork: [],
    selected: '',
  });
  expect(() => editSymbolChildren(art, 'missing', 'delete')).toThrow('Choose');
});

it('moves complete groups without rewriting affine transforms, paint or identities', () => {
  const art = [shape('a', ['g', 'inner']), shape('b', ['g']), shape('other')],
    before = structuredClone(art);
  const moved = moveSymbolChildren(art, 'a', 12, -7);
  expect(moved.slice(0, 2).map((s) => [s.x, s.y])).toEqual([
    [14, -4],
    [14, -4],
  ]);
  expect(moved[2]).toEqual(art[2]);
  expect(moved[0].transform).toEqual(art[0].transform);
  expect(moved[0].groups).toEqual(art[0].groups);
  expect(moved[0].id).toBe('a');
  expect(art).toEqual(before);
  expect(moveSymbolChildren(art, 'a', 0, 0)).toEqual(art);
  expect(() => moveSymbolChildren(art, 'a', Infinity, 0)).toThrow();
});

it('draws reversed rectangles and constrained ellipses with stable gesture identity', () => {
  expect(
    drawnSymbolPrimitive('rectangle', 'draft', { x: 40, y: 30 }, { x: 10, y: 5 }),
  ).toMatchObject({ id: 'draft', x: 10, y: 5, width: 30, height: 25 });
  expect(
    drawnSymbolPrimitive('ellipse', 'draft', { x: 40, y: 30 }, { x: 10, y: 35 }, true),
  ).toMatchObject({ kind: 'ellipse', x: 10, y: 30, width: 30, height: 30 });
  expect(() =>
    drawnSymbolPrimitive('rectangle', 'draft', { x: 0, y: 0 }, { x: NaN, y: 1 }),
  ).toThrow();
});

it('draws centered primitives and directional lines with 45-degree constraints', () => {
  expect(
    drawnSymbolPrimitive('rectangle', 'r', { x: 50, y: 50 }, { x: 60, y: 70 }, false, true),
  ).toMatchObject({ x: 40, y: 30, width: 20, height: 40 });
  const line = drawnSymbolPrimitive('line', 'l', { x: 50, y: 50 }, { x: 20, y: 50 });
  expect(line).toMatchObject({
    x: 20,
    y: 50,
    width: 30,
    height: 0,
    fillEnabled: false,
    strokeWidth: 2,
    points: [
      { x: 30, y: 0 },
      { x: 0, y: 0 },
    ],
  });
  const diagonal = drawnSymbolPrimitive('line', 'l', { x: 0, y: 0 }, { x: 10, y: 8 }, true, true);
  expect(diagonal.width).toBeCloseTo(diagonal.height);
  expect(diagonal.x).toBeCloseTo(-diagonal.width / 2);
});

it('copies detached complete groups and pastes independent affine artwork without changing either source', () => {
  const art = [shape('a', ['outer', 'inner']), shape('b', ['outer']), shape('other')];
  const copied = copySymbolChildren(art, 'b');
  expect(copied).toEqual(art.slice(0, 2));
  copied[0].fill = '#0000ff';
  expect(art[0].fill).toBe('#ff0000');
  const first = pasteSymbolChildren([shape('destination')], copied);
  const second = pasteSymbolChildren(first.artwork, copied);
  expect(new Set(second.artwork.map((s) => s.id)).size).toBe(5);
  expect(second.artwork[1].groups![0]).not.toBe(second.artwork[3].groups![0]);
  expect(first.artwork[1]).toMatchObject({
    x: 12,
    y: 13,
    fill: '#0000ff',
    transform: art[0].transform,
  });
  expect(first.artwork[1].groups![0]).toBe(first.artwork[2].groups![0]);
  expect(copied[0].x).toBe(2);
  expect(() => pasteSymbolChildren([], [])).toThrow('Copy');
});

it('transforms a complete group about shared bounds while preserving local geometry and rejecting invalid batches', () => {
  const art = [shape('a', ['g']), { ...shape('b', ['g', 'nested']), x: 80 }, shape('outside')];
  const before = structuredClone(art);
  const boxes = art.slice(0, 2).map(objectBounds);
  const cx = (Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2;
  const cy = (Math.min(...boxes.map((b) => b.top)) + Math.max(...boxes.map((b) => b.bottom))) / 2;
  const result = transformSymbolChildren(art, 'b', {
    dx: 7,
    dy: -3,
    rotation: 90,
    scaleX: -2,
    scaleY: 0.5,
  });
  for (let i = 0; i < 2; i++) {
    const original = mapPoint(matrix(art[i]), { x: 13, y: 17 });
    const next = mapPoint(matrix(result[i]), { x: 13, y: 17 });
    expect(next.x).toBeCloseTo(cx - 0.5 * (original.y - cy) + 7, 10);
    expect(next.y).toBeCloseTo(cy - 2 * (original.x - cx) - 3, 10);
    expect(result[i].groups).toEqual(art[i].groups);
    expect(result[i].points).toEqual(art[i].points);
  }
  expect(result[2]).toEqual(art[2]);
  expect(art).toEqual(before);
  expect(() =>
    transformSymbolChildren(art, 'a', { dx: 0, dy: 0, rotation: 0, scaleX: 0, scaleY: 1 }),
  ).toThrow();
  expect(() =>
    transformSymbolChildren(art, 'a', { dx: 1e20, dy: 0, rotation: 0, scaleX: 1, scaleY: 1 }),
  ).toThrow();
  expect(art).toEqual(before);
});

it('isolates one group boundary and restores nested membership and stack without mutating the parent', () => {
  const art = [
    shape('below'),
    shape('a', ['outer', 'inner']),
    shape('b', ['outer']),
    shape('above'),
  ];
  const before = structuredClone(art);
  const draft = isolateSymbolGroup(art, 'a');
  expect(draft.artwork.map((s) => s.groups)).toEqual([['inner'], undefined]);
  draft.artwork[0].x = 70;
  draft.artwork.push(shape('new'));
  const next = replaceSymbolGroup(art, draft.group, draft.artwork);
  expect(next.map((s) => s.id)).toEqual(['below', 'a', 'b', 'new', 'above']);
  expect(next[1].groups).toEqual(['outer', 'inner']);
  expect(next[3].groups).toEqual(['outer']);
  expect(art).toEqual(before);
  expect(draft.artwork[0].groups).toEqual(['inner']);
  expect(replaceSymbolGroup(art, 'outer', []).map((s) => s.id)).toEqual(['below', 'above']);
  expect(() => isolateSymbolGroup(art, 'below')).toThrow('grouped');
  expect(() => replaceSymbolGroup(art, 'missing', [])).toThrow('no longer');
});


it('transforms deduplicated outer units about one combined center in authored order', () => {
  const art=[shape('a',['g']),{...shape('b',['g','nested']),x:80,pivot:{x:2,y:3}},
    {...shape('solo'),x:140},shape('outside')];
  const before=structuredClone(art),boxes=art.slice(0,3).map(objectBounds);
  const cx=(Math.min(...boxes.map(b=>b.left))+Math.max(...boxes.map(b=>b.right)))/2;
  const cy=(Math.min(...boxes.map(b=>b.top))+Math.max(...boxes.map(b=>b.bottom)))/2;
  const result=transformSymbolChildren(art,['solo','b','a','b'],{dx:7,dy:-3,rotation:90,scaleX:-2,scaleY:.5});
  expect(result.map(s=>s.id)).toEqual(art.map(s=>s.id));
  for(let i=0;i<3;i++){
    for(const point of [{x:0,y:0},{x:13,y:17}]){
      const old=mapPoint(matrix(art[i]),point),next=mapPoint(matrix(result[i]),point);
      expect(next.x).toBeCloseTo(cx-.5*(old.y-cy)+7,10);
      expect(next.y).toBeCloseTo(cy-2*(old.x-cx)-3,10);
    }
    expect({...result[i],x:art[i].x,y:art[i].y,rotation:art[i].rotation,transform:art[i].transform}).toEqual(art[i]);
  }
  expect(result[3]).toBe(art[3]);expect(art).toEqual(before);
});

it('rejects stale selections and all-unit numeric failures without mutating originals', () => {
  const art=[shape('a'),{...shape('b'),x:99999}],before=structuredClone(art);
  const options={dx:0,dy:0,rotation:0,scaleX:1,scaleY:1};
  for(const ids of [[],['a','missing']])expect(()=>transformSymbolChildren(art,ids,options)).toThrow();
  for(const patch of [{dx:10},{scaleX:1e-12},{rotation:Infinity},{scaleY:0}]){
    expect(()=>transformSymbolChildren(art,['a','b'],{...options,...patch})).toThrow();
    expect(art).toEqual(before);
  }
  expect(transformSymbolChildren(art,['a','b'],options)).toBe(art);
});


it('uses explicit context pivots without rewriting saved local pivots', () => {
  const art=[{...shape('a',['g']),pivot:{x:4,y:7}}, {...shape('b',['g','child']),x:80},
    {...shape('solo'),x:140},shape('outside')],before=structuredClone(art);
  const pivot={x:-30,y:25};
  const result=transformSymbolChildren(art,['b','solo'],{dx:7,dy:-3,rotation:90,scaleX:-2,scaleY:.5,pivot});
  for(let i=0;i<3;i++){
    const old=mapPoint(matrix(art[i]),{x:13,y:17}),next=mapPoint(matrix(result[i]),{x:13,y:17});
    expect(next.x).toBeCloseTo(pivot.x-.5*(old.y-pivot.y)+7,10);
    expect(next.y).toBeCloseTo(pivot.y-2*(old.x-pivot.x)-3,10);
    expect(result[i].pivot).toEqual(art[i].pivot);
    expect(result[i].groups).toEqual(art[i].groups);
  }
  expect(result[3]).toBe(art[3]);expect(art).toEqual(before);expect(pivot).toEqual({x:-30,y:25});
});

it('validates original pivot coordinates before no-op or numeric preparation', () => {
  const art=[shape('a'),{...shape('b'),x:80}],before=structuredClone(art);
  const options={dx:0,dy:0,rotation:0,scaleX:1,scaleY:1};
  for(const pivot of [{x:NaN,y:0},{x:0,y:Infinity},{x:0},null,{x:'0',y:0}]){
    expect(()=>transformSymbolChildren(art,['a','b'],{...options,pivot: pivot as unknown as {x:number;y:number}})).toThrow('pivot');
    expect(art).toEqual(before);
  }
  expect(()=>transformSymbolChildren(art,['a','b'],{...options,rotation:90,pivot:{x:1e308,y:1e308}})).toThrow('geometry limits');
  expect(art).toEqual(before);
  expect(transformSymbolChildren(art,['a','b'],{...options,pivot:{x:-20,y:15}})).toBe(art);
});


it('translates multiple complete units once without rewriting their local bases or paint', () => {
  const art=[{...shape('a',['g']),pivot:{x:3,y:7}},shape('b',['g','nested']),shape('solo'),shape('outside')];
  const before=structuredClone(art);
  const result=moveSymbolChildren(art,['solo','b','a','b'],7,-3);
  expect(result).toEqual(art.map((item,i)=>i===3?item:{...item,x:item.x+7,y:item.y-3}));
  expect(result[3]).toBe(art[3]);expect(art).toEqual(before);
  result[0].transform![0]=5;expect(art).toEqual(before);
  for(const ids of [[],['a','stale']])expect(()=>moveSymbolChildren(art,ids,1,2)).toThrow('Choose');
  expect(()=>moveSymbolChildren(art,['a','solo'],Infinity,0)).toThrow('finite');
  const extreme=[shape('a'),{...shape('b'),x:Number.MAX_VALUE}],snapshot=structuredClone(extreme);
  expect(()=>moveSymbolChildren(extreme,['a','b'],Number.MAX_VALUE,0)).toThrow('finite');
  expect(extreme).toEqual(snapshot);
});


it('resolves the same deduplicated union pivot for handle and transform authoring', () => {
  const art=[{...shape('a',['g']),rotation:0,transform:undefined,x:10,y:10,width:20,height:20},
    {...shape('b',['g','child']),rotation:0,transform:undefined,x:40,y:10,width:20,height:20},
    {...shape('solo'),rotation:0,transform:undefined,x:80,y:10,width:20,height:20},shape('outside')];
  const before=structuredClone(art);
  expect(symbolTransformPivot(art,['solo','b','a'])).toEqual({x:55,y:20});
  const custom={x:30,y:40};expect(symbolTransformPivot(art,['a','solo'],custom)).toEqual(custom);
  expect(symbolTransformPivot(art,['a'],custom)).not.toBe(custom);
  expect(()=>symbolTransformPivot(art,[],custom)).toThrow('Choose');
  expect(()=>symbolTransformPivot(art,['missing'],custom)).toThrow('Choose');
  expect(()=>symbolTransformPivot(art,['a'],{x:NaN,y:0})).toThrow('finite');
  const result=transformSymbolChildren(art,['a','solo'],{dx:0,dy:0,rotation:90,scaleX:1,scaleY:1});
  for(let i=0;i<3;i++){
    const p=mapPoint(matrix(result[i]),{x:0,y:0});
    expect(p.x).toBeCloseTo(55-(art[i].y-20),10);expect(p.y).toBeCloseTo(20+(art[i].x-55),10);
  }
  expect(art).toEqual(before);
});


it('applies opposite-corner, pivot, proportional and reflected handle matrices to complete units', () => {
  const art=[{...shape('a',['g']),pivot:{x:4,y:7}},{...shape('b',['g','child']),x:80},
    {...shape('solo'),x:140},shape('outside')],before=structuredClone(art);
  const box=symbolTransformBounds(art,['solo','b','a']),pivot=symbolTransformPivot(art,['a','solo']);
  const start={x:box.right,y:box.bottom};
  for(const [end,shift,alt] of [[{x:box.right+100,y:box.bottom+30},false,false],
    [{x:box.right+50,y:box.bottom},true,true],[{x:box.left-100,y:box.bottom},false,false]] as const){
    const op=rangeHandleTransform('se',box,pivot,start,end,shift,alt);
    const result=affineSymbolChildren(art,['solo','b','a','b'],op);
    for(let i=0;i<3;i++){
      const p={x:13,y:17},old=mapPoint(matrix(art[i]),p),next=mapPoint(matrix(result[i]),p),expected=mapPoint(op,old);
      expect(next.x).toBeCloseTo(expected.x,10);expect(next.y).toBeCloseTo(expected.y,10);
      expect({...result[i],x:art[i].x,y:art[i].y,rotation:art[i].rotation,transform:art[i].transform}).toEqual(art[i]);
    }
    expect(result[3]).toBe(art[3]);expect(art).toEqual(before);
  }
});

it('rejects affine all-member overflow and collapse atomically without changing geometry limits', () => {
  const art=[shape('a'),{...shape('b'),x:99999}],before=structuredClone(art);
  for(const op of [[1,0,0,1,10,0],[0,0,0,1,0,0],[NaN,0,0,1,0,0]] as [number,number,number,number,number,number][]){
    expect(()=>affineSymbolChildren(art,['a','b'],op)).toThrow('geometry limits');expect(art).toEqual(before);
  }
});


it('prepares shared edge skew with complete units, unchanged pivots and atomic rejection', () => {
  const art=[{...shape('a',['g']),pivot:{x:3,y:7}},{...shape('b',['g','child']),x:80},
    {...shape('solo'),x:140},shape('outside')],before=structuredClone(art);
  const box=symbolTransformBounds(art,['a','solo']),pivot=symbolTransformPivot(art,['a','solo']);
  for(const edge of ['n','e','s','w'])for(const alt of [false,true]){
    const horizontal=edge==='n'||edge==='s';
    const start={x:edge==='w'?box.left:edge==='e'?box.right:pivot.x,y:edge==='n'?box.top:edge==='s'?box.bottom:pivot.y};
    const end={x:start.x+(horizontal?17:0),y:start.y+(horizontal?0:17)};
    const operation=rangeHandleTransform('skew-'+edge,box,pivot,start,end,false,alt);
    const result=affineSymbolChildren(art,['solo','b','a'],operation);
    for(let i=0;i<3;i++){
      const old=mapPoint(matrix(art[i]),{x:13,y:17}),next=mapPoint(matrix(result[i]),{x:13,y:17});
      const expected=mapPoint(operation,old);
      expect(next.x).toBeCloseTo(expected.x,10);expect(next.y).toBeCloseTo(expected.y,10);
      expect({...result[i],x:art[i].x,y:art[i].y,rotation:art[i].rotation,transform:art[i].transform}).toEqual(art[i]);
    }
    expect(result[3]).toBe(art[3]);expect(art).toEqual(before);
  }
  expect(()=>affineSymbolChildren(art,['a','solo'],[1,0,1e9,1,0,0])).toThrow('geometry limits');
  expect(art).toEqual(before);
});


it('copies and pastes all checked complete units with consistent fresh detached identities', () => {
  const art=[{...shape('a',['outer','child']),pivot:{x:3,y:7}},shape('b',['outer']),
    shape('solo'),shape('other')],before=structuredClone(art);
  const copied=copySymbolChildren(art,['solo','b','a','b']);
  expect(copied).toEqual(art.slice(0,3));
  const first=pasteSymbolChildren([shape('target')],copied),second=pasteSymbolChildren(first.artwork,copied);
  expect(first.artwork).toHaveLength(4);expect(second.artwork).toHaveLength(7);
  expect(first.artwork[1].id).toBe(first.selected);
  expect(new Set(second.artwork.map(item=>item.id)).size).toBe(7);
  expect(first.artwork[1].groups![0]).toBe(first.artwork[2].groups![0]);
  expect(first.artwork[1].groups![0]).not.toBe('outer');
  expect(first.artwork[1].groups![1]).not.toBe('child');
  expect(first.artwork[1].groups![0]).not.toBe(second.artwork[4].groups![0]);
  for(let i=0;i<3;i++){
    const pasted=first.artwork[i+1],original=copied[i];
    expect({...pasted,id:original.id,x:pasted.x-10,y:pasted.y-10,groups:original.groups}).toEqual(original);
  }
  first.artwork[1].transform![0]=99;expect(copied).toEqual(art.slice(0,3));expect(art).toEqual(before);
});

it('rejects original clipboard identity/position/ancestry errors and preserves other invalid numerics', () => {
  const valid=shape('a'),bad={...valid,transform:[NaN,0,0,1] as [number,number,number,number]};
  const raw=copySymbolChildren([bad],'a');expect(Number.isNaN(raw[0].transform![0])).toBe(true);
  const pasted=pasteSymbolChildren([],raw);expect(Number.isNaN(pasted.artwork[0].transform![0])).toBe(true);
  // Shape identity strings are intentionally broader than group identifiers in the existing schema.
  expect(pasteSymbolChildren([],[{...valid,id:'legacy.art / Δ'}]).artwork).toHaveLength(1);
  for(const clip of [[valid,valid],[{...valid,id:1} as unknown as Vector],[{...valid,x:NaN}],[{...valid,groups:['']}],
    [{...valid,groups:['same','same']}]])expect(()=>pasteSymbolChildren([],clip)).toThrow('clipboard');
});


it('edits checked complete unions in authored order without mutating clipboard-like source data', () => {
  const art=[shape('below'),{...shape('a',['g']),pivot:{x:3,y:7}},shape('member',['g','child']),
    shape('gap'),shape('solo'),shape('above')],before=structuredClone(art),ids=['solo','member','a','solo'];
  expect(editSymbolChildren(art,ids,'front').artwork.map(item=>item.id)).toEqual(['below','gap','above','a','member','solo']);
  expect(editSymbolChildren(art,ids,'back').artwork.map(item=>item.id)).toEqual(['a','member','solo','below','gap','above']);
  expect(editSymbolChildren(art,ids,'delete').artwork).toEqual([art[0],art[3],art[5]]);
  const result=editSymbolChildren(art,ids,'duplicate'),copies=result.artwork.slice(5,8);
  expect(result.artwork.slice(0,5)).toEqual(art.slice(0,5));expect(result.artwork[8]).toBe(art[5]);
  expect(new Set(result.artwork.map(item=>item.id)).size).toBe(9);expect(result.selected).toBe(copies[0].id);
  expect(copies[0].groups![0]).toBe(copies[1].groups![0]);expect(copies[0].groups![0]).not.toBe('g');
  expect(copies[1].groups![1]).not.toBe('child');
  for(const [i,original] of [art[1],art[2],art[4]].entries())
    expect({...copies[i],id:original.id,x:copies[i].x-10,y:copies[i].y-10,groups:original.groups}).toEqual(original);
  expect(art).toEqual(before);copies[0].transform![0]=99;expect(art).toEqual(before);
  for(const action of ['duplicate','delete','front','back'] as const){
    expect(()=>editSymbolChildren(art,[],action)).toThrow('Choose');
    expect(()=>editSymbolChildren(art,['a','stale'],action)).toThrow('Choose');
  }
});


it('admits the original library and rejects the whole duplicated expansion without mutating it', () => {
  const p=newProject();p.symbols=[{id:'leaf-budget',name:'Leaf',width:10,height:10,shapes:[shape('leaf-art')]}];
  for(let level=1;level<=6;level++){
    const previous=p.symbols[p.symbols.length-1];
    p.symbols.push({id:'budget-'+level,name:'Budget '+level,width:10,height:10,
      shapes:Array.from({length:5},()=>symbolInstance(previous,0,0))});
  }
  const previous=p.symbols[p.symbols.length-1];
  const source={id:'budget-source',name:'Budget source',width:10,height:10,
    shapes:Array.from({length:4},()=>symbolInstance(previous,0,0))};
  p.symbols.push(source);expect(()=>validateProject(p)).not.toThrow();
  const before=structuredClone(p),candidate=structuredClone(p);
  candidate.symbols![candidate.symbols!.length-1].shapes=editSymbolChildren(source.shapes,source.shapes.map(item=>item.id),'duplicate').artwork;
  expect(()=>validateProject(candidate)).toThrow('nested symbol expansion budget');expect(p).toEqual(before);
});


it('groups complete units at their highest stack position and unwraps only one boundary', () => {
  const art=[shape('below'),{...shape('a',['g']),pivot:{x:3,y:7}},shape('member',['g','child']),shape('gap'),shape('solo'),shape('above')],
    before=structuredClone(art);
  const grouped=editSymbolChildren(art,['solo','member','a'],'group');
  expect(grouped.artwork.map(item=>item.id)).toEqual(['below','gap','a','member','solo','above']);
  const members=grouped.artwork.slice(2,5),group=members[0].groups![0];
  expect(group).not.toBe('g');expect(members[0].groups).toEqual([group,'g']);
  expect(members[1].groups).toEqual([group,'g','child']);expect(members[2].groups).toEqual([group]);
  for(const [i,original] of [art[1],art[2],art[4]].entries())expect({...members[i],groups:original.groups}).toEqual(original);
  const ungrouped=editSymbolChildren(grouped.artwork,'solo','ungroup');
  expect(ungrouped.artwork.map(item=>item.id)).toEqual(grouped.artwork.map(item=>item.id));
  for(const item of ungrouped.artwork)expect({...item,groups:art.find(original=>original.id===item.id)!.groups}).toEqual(art.find(original=>original.id===item.id));
  expect(ungrouped.artwork.find(item=>item.id==='a')!.groups).toEqual(['g']);
  expect(ungrouped.artwork.find(item=>item.id==='member')!.groups).toEqual(['g','child']);
  expect(editSymbolChildren(art,'solo','ungroup').artwork).toBe(art);
  expect(art).toEqual(before);
});

it('rejects grouping limits and invalid original ancestry atomically while admitting depth 32', () => {
  const ancestry=Array.from({length:31},(_,i)=>'g'+i),a={...shape('a',ancestry),pivot:{x:3,y:7}},solo=shape('solo');
  const art=[a,solo],before=structuredClone(art);
  expect(editSymbolChildren(art,['a','solo'],'group').artwork[0].groups).toHaveLength(32);
  expect(()=>editSymbolChildren(art,['a'],'group')).toThrow('at least two');
  const tooDeep=[{...a,groups:[...ancestry,'g31']},solo],snapshot=structuredClone(tooDeep);
  expect(()=>editSymbolChildren(tooDeep,['a','solo'],'group')).toThrow('32');expect(tooDeep).toEqual(snapshot);
  const invalid=[shape('a',['g','child']),shape('other',['other','child']),solo],invalidBefore=structuredClone(invalid);
  expect(()=>editSymbolChildren(invalid,['a','solo'],'group')).toThrow('parent');
  expect(invalid).toEqual(invalidBefore);expect(art).toEqual(before);
});
