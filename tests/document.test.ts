import { describe, it, expect } from 'vitest';
import {
  newProject,
  newLayer,
  id,
  clone,
  insertKey,
  keyAt,
  validateProject,
  migrateProject,
  History,
  type Vector,
} from '../packages/document/src';
import { evaluate, frameAtTime } from '../packages/animation/src';
import { hit } from '../packages/geometry/src';
import { exportHTML } from '../packages/export-web/src';
export const rectangle = (): Vector => ({
  id: id(),
  kind: 'rectangle',
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  rotation: 0,
  fill: '#ff0000',
  stroke: '#000000',
  strokeWidth: 2,
  points: [],
});
describe('renderer-independent document and timeline', () => {
  it('holds a drawing until the next key, copies editable geometry, then supports blank frames', () => {
    const p = newProject();
    p.layers[0].keys[0].shapes.push(rectangle());
    insertKey(p.layers[0], 5);
    keyAt(p.layers[0], 5).shapes[0].x = 200;
    insertKey(p.layers[0], 10, true);
    expect(evaluate(p, 4)[0].x).toBe(10);
    expect(evaluate(p, 5)[0].x).toBe(200);
    expect(evaluate(p, 10)).toEqual([]);
    expect(keyAt(p.layers[0], 0).shapes[0].x).toBe(10);
  });
  it('evaluates bottom-to-top visible layers deterministically', () => {
    const p = newProject();
    const a = rectangle(),
      b = rectangle();
    p.layers[0].keys[0].shapes.push(a);
    p.layers.push(newLayer('Top'));
    p.layers[1].keys[0].shapes.push(b);
    expect(evaluate(p, 0).map((s) => s.id)).toEqual([a.id, b.id]);
    p.layers[1].visible = false;
    expect(evaluate(p, 100).map((s) => s.id)).toEqual([a.id]);
    expect(frameAtTime(1, 24, 48)).toBe(24);
    expect(frameAtTime(2, 24, 48)).toBe(0);
  });
  it('undoes an entire drag, redoes it, and invalidates redo after another operation', () => {
    let p = newProject();
    const h = new History();
    h.record(p, 'Draw');
    p.layers[0].keys[0].shapes.push(rectangle());
    const before = clone(p);
    p.layers[0].keys[0].shapes[0].x = 500;
    h.record(before, 'Move');
    expect(h.undoLabel).toBe('Move');
    p = h.undo(p)!;
    expect(evaluate(p, 0)[0].x).toBe(10);
    p = h.redo(p)!;
    expect(evaluate(p, 0)[0].x).toBe(500);
    p = h.undo(p)!;
    h.record(p, 'Recolor');
    expect(h.redo(p)).toBeUndefined();
  });
  it('migrates the internal v0 prototype and rejects future schema, invalid frames, NaN and traversal', () => {
    const p = newProject();
    expect(migrateProject({ ...p, schemaVersion: 0 }).schemaVersion).toBe(59);
    expect(() => validateProject({ ...p, schemaVersion: 999 })).toThrow();
    expect(() => validateProject({ ...p, width: NaN })).toThrow();
    const bad = clone(p);
    bad.layers[0].keys[0].frame = 1;
    expect(() => validateProject(bad)).toThrow();
    p.assets = [{ id: 'evil', path: 'assets/../../secret' }];
    expect(() => validateProject(p)).toThrow();
  });
});
describe('geometry and export', () => {
  it('hit tests rotated objects, oval bounds, and negative-slope lines', () => {
    const s = rectangle();
    s.rotation = 90;
    expect(hit(s, { x: -15, y: 70 }, 0)).toBe(true);
    expect(hit(s, { x: 80, y: 20 }, 0)).toBe(false);
    s.rotation = 0;
    s.kind = 'ellipse';
    expect(hit(s, { x: 10, y: 20 }, 0)).toBe(false);
    expect(hit(s, { x: 60, y: 45 }, 0)).toBe(true);
    s.kind = 'line';
    s.points = [
      { x: 0, y: 50 },
      { x: 100, y: 0 },
    ];
    expect(hit(s, { x: 60, y: 45 }, 1)).toBe(true);
    expect(hit(s, { x: 10, y: 20 }, 1)).toBe(false);
  });
  it('escapes HTML delimiters inside the embedded project rather than executing imported names', () => {
    const p = newProject('</script><script>alert(1)</script>');
    const html = exportHTML(p);
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('requestAnimationFrame');
  });
});

it('validates saved pivots independently of artwork and ignores legacy unknown pivots', () => {
  const p = newProject();
  p.multiFramePivot = { x: -45.5, y: 12000 };
  p.symbols = [
    {
      id: 's',
      name: 'S',
      width: 100,
      height: 100,
      shapes: [rectangle()],
      multiFramePivot: { x: 0, y: 25.25 },
    },
  ];
  expect(validateProject(p)).toEqual(p);
  for (const bad of [null, {}, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: '1', y: 0 }]) {
    expect(() => validateProject({ ...p, multiFramePivot: bad })).toThrow('multi-frame pivot');
    expect(() =>
      validateProject({ ...p, symbols: [{ ...p.symbols![0], multiFramePivot: bad }] }),
    ).toThrow('multi-frame pivot');
  }
  const legacy = migrateProject({ ...p, schemaVersion: 27 });
  expect(legacy.multiFramePivot).toBeUndefined();
  expect(legacy.symbols![0].multiFramePivot).toBeUndefined();
  expect(legacy.symbols![0].shapes).toEqual(p.symbols![0].shapes);
  expect(p.multiFramePivot).toEqual({ x: -45.5, y: 12000 });
});

it('reserves opacityBindings for schema 47 root documents',()=>{
 const p=newProject();
 for(let version=0;version<=46;version++)expect(()=>migrateProject({...p,schemaVersion:version,opacityBindings:[]})).toThrow(/schema 47/);
 const symbol={id:'s',name:'Symbol',width:10,height:10,shapes:[{id:'a',kind:'rectangle',x:0,y:0,width:10,height:10,rotation:0,strokeWidth:0,stroke:'#000000',fill:'#ff0000',points:[]}],timeline:{duration:1,keys:[]}};
 for(const misplaced of [{...p,layers:[{...p.layers[0],opacityBindings:[]}]},{...p,symbols:[{...symbol,opacityBindings:[]}]},{...p,symbols:[{...symbol,timeline:{...symbol.timeline,opacityBindings:[]}}]}])
  expect(()=>validateProject(misplaced)).toThrow(/root document/);
 expect(validateProject({...p,opacityBindings:[]}).opacityBindings).toEqual([]);expect(migrateProject({...p,schemaVersion:46}).opacityBindings).toBeUndefined();
});
